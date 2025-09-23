// /server/crawler.js — robust, single-tab, same-site crawler (BFS, 25 pages, sitemap seeding, basic robots)
// Contract:
//   crawlSite(startUrl, maxPages = 25, browser?) =>
//     Promise<Array<{ url: string, html: string, links: { internal: number, external: number, total: number } }>>
//
// Notes:
//  - Reuses ONE page for speed and to look more “human”.
//  - Accepts an existing Puppeteer browser from runAudit (preferred).
//  - Survives redirects (http -> https, apex <-> www) and widens allowed host set accordingly.
//  - Blocks heavy trackers/media/fonts to keep crawl fast and reduce bot flags.
//  - Seeds from /sitemap.xml when present (top N URLs), still capped by maxPages.
//  - Basic robots.txt Disallow parsing for User-agent: * (respect on by default; disable with RESPECT_ROBOTS=false)

'use strict';

const { URL } = require('url');
const http = require('http');
const https = require('https');
const puppeteer = require('puppeteer');

const NAV_TIMEOUT_MS   = 35_000;
const BODY_WAIT_MS     = 5_000;
const IDLE_TIMEOUT_MS  = 3_000;
const VIEWPORT         = { width: 1366, height: 768 };

// --------- env toggles ---------
const RESPECT_ROBOTS = String(process.env.RESPECT_ROBOTS || 'true').toLowerCase() !== 'false';
const SITEMAP_SEED_LIMIT = Math.max(5, Math.min(20, Number(process.env.SITEMAP_SEED_LIMIT) || 10));

// ---------- tiny helpers ----------
function httpGet(url, timeout = 8000) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 512 * 1024) { // cap ~512KB
            req.destroy();
            resolve('');
          }
        });
        res.on('end', () => resolve(data || ''));
      });
      req.on('timeout', () => { req.destroy(); resolve(''); });
      req.on('error', () => resolve(''));
    } catch {
      resolve('');
    }
  });
}

function canonicalize(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';   // drop fragments
    u.search = ''; // drop query for identity
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, ''); // normalize trailing slash
    return u.toString();
  } catch {
    return null;
  }
}

function isAsset(urlStr) {
  return /\.(?:jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|rar|7z|mp4|webm|mp3|wav|mov|avi|docx?|xlsx?|pptx?)$/i
    .test(urlStr);
}

function buildAllowedHosts(host) {
  const bare = host.replace(/^www\./i, '');
  return new Set([host.toLowerCase(), bare.toLowerCase(), (`www.${bare}`).toLowerCase()]);
}

function normalizeLink(href, baseUrl, allowedHosts) {
  try {
    const u = new URL(href, baseUrl);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!allowedHosts.has(u.host.toLowerCase())) return null;
    const c = canonicalize(u.toString());
    if (!c || isAsset(c)) return null;
    return c;
  } catch {
    return null;
  }
}

// ---------- robots.txt (basic Disallow for UA: *) ----------
function parseRobots(robotsTxt) {
  // Very simple parser: collect Disallow under "User-agent: *" until the next "User-agent:"
  const lines = (robotsTxt || '').split(/\r?\n/).map(l => l.trim());
  const disallow = [];
  let inStar = false;
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const lower = line.toLowerCase();
    if (lower.startsWith('user-agent:')) {
      const ua = line.split(':')[1]?.trim().toLowerCase() || '';
      inStar = (ua === '*' || ua === '"*"');
    } else if (inStar && lower.startsWith('disallow:')) {
      const path = line.split(':')[1]?.trim() || '';
      if (path) disallow.push(path);
    }
  }
  return disallow;
}

function pathDisallowed(pathname, disallows) {
  // Convert basic robots wildcards to regex
  for (const rule of disallows) {
    let r = rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'); // escape + wildcard
    if (!r.startsWith('/')) r = '/' + r;
    const re = new RegExp('^' + r);
    if (re.test(pathname)) return true;
  }
  return false;
}

// ---------- sitemap.xml seeding ----------
async function fetchSitemapUrls(origin, limit = SITEMAP_SEED_LIMIT) {
  // Try robots.txt to find Sitemap: lines first; else fallback to /sitemap.xml
  let locations = [];
  if (RESPECT_ROBOTS) {
    const robots = await httpGet(new URL('/robots.txt', origin).href);
    const lines = robots.split(/\r?\n/);
    for (const ln of lines) {
      const m = ln.match(/^\s*sitemap:\s*(.+)$/i);
      if (m && m[1]) locations.push(m[1].trim());
    }
  }
  if (locations.length === 0) {
    locations = [new URL('/sitemap.xml', origin).href];
  }

  const urls = new Set();
  for (const loc of locations) {
    const xml = await httpGet(loc);
    if (!xml) continue;

    // super-lightweight: extract <loc> ... </loc>
    const re = /<loc>([^<]+)<\/loc>/gi;
    let m;
    while ((m = re.exec(xml)) && urls.size < limit) {
      const href = m[1].trim();
      try {
        const u = new URL(href, origin);
        urls.add(u.toString());
      } catch {}
    }
    if (urls.size >= limit) break;
  }
  return [...urls];
}

// ---------- “stealthy” page setup ----------
async function hardenPage(page) {
  const ua =
    process.env.AUDIT_UA ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
  });
  await page.setViewport(VIEWPORT);

  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      const orig = navigator.permissions && navigator.permissions.query;
      if (orig) {
        navigator.permissions.query = (p) =>
          p && p.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : orig(p);
      }
    } catch {}
  });

  await page.setRequestInterception(true);
  const blockRe = /(doubleclick\.net|googletagmanager\.com|google-analytics\.com|hotjar\.com|facebook\.net|optimizely\.com|segment\.io|newrelic\.com|nr-data\.net)/i;
  page.on('request', (req) => {
    const url = req.url();
    const rtype = req.resourceType();
    if (blockRe.test(url) || rtype === 'media' || rtype === 'font') return req.abort();
    return req.continue();
  });
}

// Try different wait modes to get some HTML even on JS-heavy pages
async function navigateWithFallback(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  } catch {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    } catch {
      await page.goto(url, { timeout: NAV_TIMEOUT_MS }).catch(() => {});
    }
  }
  await page.waitForSelector('body', { timeout: BODY_WAIT_MS }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 1_000, timeout: IDLE_TIMEOUT_MS }).catch(() => {});
}

async function fetchHtml(page, url) {
  await navigateWithFallback(page, url);
  const html = await page.content();
  return html || '';
}

async function extractLinks(page, currentUrl, allowedHosts) {
  const hrefs = await page
    .$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')).filter(Boolean))
    .catch(() => []);
  const out = new Set();
  for (const h of hrefs) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(h)) continue;
    const n = normalizeLink(h, currentUrl, allowedHosts);
    if (n) out.add(n);
  }
  return out;
}

// ---------- diversity bias ----------
function bucketKey(urlStr) {
  try {
    const u = new URL(urlStr);
    // e.g. "/blog/2024/post-title" -> "blog"
    const first = u.pathname.split('/').filter(Boolean)[0] || '';
    return first.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Crawl a site breadth-first using a single tab.
 * @param {string} startUrl
 * @param {number} maxPages (default 25)
 * @param {import('puppeteer').Browser=} browser
 */
async function crawlSite(startUrl, maxPages = 25, browser = null) {
  if (!/^https?:\/\//i.test(startUrl)) throw new Error('crawler: startUrl must be http(s)');

  const startCanon = canonicalize(startUrl);
  if (!startCanon) throw new Error('crawler: invalid start URL');

  const start = new URL(startCanon);
  const origin = start.origin;
  const allowedHosts = buildAllowedHosts(start.host);

  // robots
  let disallows = [];
  if (RESPECT_ROBOTS) {
    const robotsTxt = await httpGet(new URL('/robots.txt', origin).href);
    disallows = parseRobots(robotsTxt);
  }

  let ownBrowser = false;
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: VIEWPORT,
    });
    ownBrowser = true;
  }

  const page = await browser.newPage();
  await hardenPage(page);

  const visited = new Set();
  const queued  = new Set();
  const queue   = [];
  const results = [];

  // seed: start + sitemap (top N)
  const seeds = new Set([startCanon]);
  try {
    const smUrls = await fetchSitemapUrls(origin, SITEMAP_SEED_LIMIT);
    for (const u of smUrls) {
      const n = normalizeLink(u, origin, allowedHosts);
      if (n) seeds.add(n);
    }
  } catch {}
  for (const s of seeds) {
    if (!queued.has(s)) { queue.push(s); queued.add(s); }
  }

  // keep track of buckets to prefer diverse templates
  const seenBuckets = new Set([bucketKey(startCanon)]);

  try {
    while (queue.length && results.length < maxPages) {
      const current = queue.shift();
      queued.delete(current);
      if (visited.has(current)) continue;

      // robots Disallow?
      try {
        const curPath = new URL(current).pathname;
        if (RESPECT_ROBOTS && disallows.length && pathDisallowed(curPath, disallows)) {
          visited.add(current);
          continue;
        }
      } catch {}

      let html = '';
      let linksBreakdown = { internal: 0, external: 0, total: 0 };

      try {
        await navigateWithFallback(page, current);

        // expand allowed hosts if redirected (apex <-> www)
        try {
          const finalUrl = page.url();
          const finalHost = new URL(finalUrl).host;
          buildAllowedHosts(finalHost).forEach((h) => allowedHosts.add(h));
        } catch {}

        html = await page.content();

        linksBreakdown = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          let data = { internal: 0, external: 0, total: 0 };
          const here = location.host.toLowerCase();
          for (const a of anchors) {
            const href = a.getAttribute('href');
            if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
            try {
              const u = new URL(href, location.href);
              data.total++;
              if (u.host.toLowerCase() === here) data.internal++;
              else data.external++;
            } catch {}
          }
          return data;
        });
      } catch {
        // keep going
      }

      visited.add(current);
      results.push({ url: current, html, links: linksBreakdown });

      // Enqueue neighbors (BFS with diversity bias)
      try {
        const links = await extractLinks(page, current, allowedHosts);

        // Prefer links that introduce new first-path buckets first
        const fresh = [];
        const common = [];
        for (const n of links) {
          const b = bucketKey(n);
          if (!visited.has(n) && !queued.has(n)) {
            if (!seenBuckets.has(b)) fresh.push(n);
            else common.push(n);
          }
        }

        // add fresh buckets first, then common
        for (const n of fresh) {
          const b = bucketKey(n);
          seenBuckets.add(b);
          if (results.length + queue.length >= maxPages + 8) break;
          queue.push(n); queued.add(n);
        }
        for (const n of common) {
          if (results.length + queue.length >= maxPages + 8) break;
          queue.push(n); queued.add(n);
        }
      } catch {
        /* ignore extract errors */
      }
    }
  } finally {
    await page.close().catch(() => {});
    if (ownBrowser) {
      await browser.close().catch(() => {});
    }
  }

  return results;
}

module.exports = crawlSite;
