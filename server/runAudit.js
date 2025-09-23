// /server/runAudit.js — crawl → screenshot → Lighthouse (median of 3) → PSI → signals → scoring
'use strict';

// --- make Chromium path explicit for both puppeteer & lighthouse ---
const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium'
const fs = require('fs');
const path = require('path');
const https = require('https');
const puppeteer = require('puppeteer');
const { launch: launchChrome } = require('chrome-launcher');

const crawlSite = require('./crawler');
const buildStructuredSignals = require('./buildStructuredSignals');
const scoringEngine = require('./scoringEngine');

// ---------- constants / env ----------
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const VIEWPORT = { width: 1366, height: 768, deviceScaleFactor: 1 };
const NAV_TIMEOUT_MS = 45_000;
const MAX_PAGES = Math.max(10, Math.min(50, Number(process.env.MAX_PAGES) || 25));

const LH_FORM_FACTOR = String(process.env.LH_FORM_FACTOR || '').toLowerCase();
const PSI_API_KEY = process.env.PSI_API_KEY || '';
const PSI_BLEND = String(process.env.PSI_BLEND || '0') === '1';
const PSI_TIMEOUT_MS = Math.max(5000, Math.min(15000, Number(process.env.PSI_TIMEOUT_MS) || 9000));

const ensureDir = (dir) => { try { fs.mkdirSync(dir, { recursive: true }); } catch {} };

// Lazy import for Lighthouse (ESM only)
async function getLighthouse() {
  const mod = await import('lighthouse');
  return mod.default || mod;
}

// ---------- utils ----------
function median(arr) {
  const a = arr.filter((x) => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function httpsJSON(url, timeout = PSI_TIMEOUT_MS) {
  return new Promise((resolve) => {
    try {
      const req = https.get(url, { timeout }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
          if (data.length > 1024 * 1024) { req.destroy(); resolve(null); }
        });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

function fieldPerformanceProxy(psiJson) {
  try {
    const lx = psiJson?.loadingExperience || psiJson?.originLoadingExperience;
    const m = lx?.metrics || null;
    if (!m) return null;
    const keys = ['LARGEST_CONTENTFUL_PAINT_MS', 'INTERACTION_TO_NEXT_PAINT', 'CUMULATIVE_LAYOUT_SHIFT_SCORE'];
    const pickGoodRatio = (metric) => {
      const dist = metric?.distributions || [];
      const good = dist.find((d) => String(d.min || '0') === '0');
      return typeof good?.proportion === 'number' ? good.proportion : null;
    };
    const vals = keys.map((k) => pickGoodRatio(m[k])).filter((x) => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  } catch { return null; }
}

// ---------- Lighthouse median-of-3 ----------
async function runLighthouseMedian(url) {
  const chrome = await launchChrome({
    chromePath: CHROME_PATH,
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu', '--window-size=1366,768'],
  });
  

  const config =
    LH_FORM_FACTOR === 'desktop'
      ? {
          extends: 'lighthouse:default',
          settings: {
            formFactor: 'desktop',
            screenEmulation: { mobile: false, width: 1366, height: 768, deviceScaleFactor: 1, disabled: false }
          }
        }
      : undefined;

  try {
    const lighthouse = await getLighthouse();
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      const result = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error' }, config);
      const cat = result.lhr?.categories || {};
      rounds.push({
        performance:   cat.performance?.score ?? null,
        accessibility: cat.accessibility?.score ?? null,
        seo:           cat.seo?.score ?? null,
        bestPractices: cat['best-practices']?.score ?? null,
        lhr: i === 2 ? result.lhr : null
      });
    }
    const med = {
      performance:   median(rounds.map(r => r.performance)),
      accessibility: median(rounds.map(r => r.accessibility)),
      seo:           median(rounds.map(r => r.seo)),
      bestPractices: median(rounds.map(r => r.bestPractices)),
    };
    try {
      const auditsDir = path.join(__dirname, '..', 'audits');
      ensureDir(auditsDir);
      const last = rounds.find(r => r.lhr)?.lhr;
      if (last) {
        const p = path.join(auditsDir, `report-${Date.now()}.json`);
        fs.writeFileSync(p, JSON.stringify(last, null, 2));
      }
    } catch {}
    return med;
  } finally {
    try { await chrome.kill(); } catch {}
  }
}

// ---------- PSI ----------
async function fetchPSI(url) {
  if (!PSI_API_KEY) return null;
  const strategy = LH_FORM_FACTOR === 'desktop' ? 'desktop' : 'mobile';
  const api = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const qs =
    `?url=${encodeURIComponent(url)}&strategy=${strategy}` +
    `&category=PERFORMANCE&category=ACCESSIBILITY&category=BEST_PRACTICES&category=SEO` +
    `&key=${encodeURIComponent(PSI_API_KEY)}`;
  return await httpsJSON(api + qs, PSI_TIMEOUT_MS);
}

// ---------- main ----------
async function runAudit(targetUrl, siteType = 'base') {
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error('Invalid URL. Use http(s)://');

  let browser, pages = [], screenshotBase64 = null, lighthouseLab = {}, psi = null, structuredSignals = {}, scores = {};

  try {
    browser = await puppeteer.launch({
      headless: true,                          // or 'new'
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--ignore-certificate-errors',
        '--window-size=1366,768',
      ],
      defaultViewport: VIEWPORT,
    });
    

    try { pages = await crawlSite(targetUrl, MAX_PAGES, browser); } catch { pages = []; }
    if (!pages.length) {
      try {
        const p = await browser.newPage();
        await p.setUserAgent(DESKTOP_UA);
        await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await p.waitForSelector('body', { timeout: 5_000 }).catch(() => {});
        const html = await p.content();
        pages = [{ url: targetUrl, html, links: { internal: 0, external: 0, total: 0 } }];
        await p.close();
      } catch {}
    }

    try {
      const p = await browser.newPage();
      await p.setUserAgent(DESKTOP_UA);
      await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await p.waitForSelector('body', { timeout: 5_000 }).catch(() => {});
      const buf = await p.screenshot({ fullPage: false });
      screenshotBase64 = buf.toString('base64');
      await p.close();
    } catch {}

    try { lighthouseLab = await runLighthouseMedian(targetUrl); } catch { lighthouseLab = {}; }
    try { psi = await fetchPSI(targetUrl); } catch { psi = null; }

    try {
      const home = pages[0] || { url: targetUrl, html: '' };
      structuredSignals = await buildStructuredSignals(home, pages);
    } catch { structuredSignals = {}; }

    let perfForScoring = lighthouseLab?.performance ?? null;
    if (PSI_BLEND && psi) {
      const fieldProxy = fieldPerformanceProxy(psi);
      if (fieldProxy != null && perfForScoring != null) {
        perfForScoring = 0.7 * perfForScoring + 0.3 * fieldProxy;
      }
    }

    try {
      const lhForScoring = {
        performance:   perfForScoring ?? lighthouseLab?.performance ?? null,
        accessibility: lighthouseLab?.accessibility ?? null,
        bestPractices: lighthouseLab?.bestPractices ?? null,
        seo:           lighthouseLab?.seo ?? null
      };
      scores = scoringEngine(structuredSignals, siteType, { lighthouse: lhForScoring });
    } catch { scores = {}; }
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }

  const lighthouse = {
    performance:   lighthouseLab?.performance ?? null,
    accessibility: lighthouseLab?.accessibility ?? null,
    seo:           lighthouseLab?.seo ?? null,
    bestPractices: lighthouseLab?.bestPractices ?? null,
    fieldProxy: (fieldPerformanceProxy(psi) ?? null),
    strategy: (LH_FORM_FACTOR === 'desktop' ? 'desktop' : 'mobile')
  };

  return { url: targetUrl, siteType, structuredSignals, scores, lighthouse, screenshotBase64 };
}

module.exports = runAudit;
