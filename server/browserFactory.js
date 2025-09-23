// server/browserFactory.js — stealth browser & page prep for robust crawling
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

function buildLaunchArgs() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1366,768',
  ];
  if (process.env.PROXY_URL) args.push(`--proxy-server=${process.env.PROXY_URL}`);
  return args;
}

async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: true,              // stealth-friendly headless
    args: buildLaunchArgs(),
    ignoreDefaultArgs: ['--enable-automation'],
  });
  return browser;
}

async function preparePage(page) {
  // Optional proxy auth
  if (process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD) {
    try {
      await page.authenticate({
        username: process.env.PROXY_USERNAME,
        password: process.env.PROXY_PASSWORD,
      });
    } catch {}
  }

  // Clean, real-looking UA (strip "HeadlessChrome")
  try {
    const ua = await page.browser().userAgent();
    await page.setUserAgent(ua.replace('HeadlessChrome', 'Chrome'));
  } catch {}

  await page.setViewport({
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });

  await page.setExtraHTTPHeaders({
    'Accept-Language': process.env.ACCEPT_LANGUAGE || 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
  });

  // CSP bypass helps when reading inline JSON-LD, etc.
  await page.setBypassCSP(true);

  // Block heavy resources (we don’t need binary assets to parse DOM/attrs)
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    // Keep document, script, xhr, fetch; block the rest for speed
    if (['image', 'media', 'font', 'stylesheet', 'manifest', 'other'].includes(type)) {
      return req.abort();
    }
    return req.continue();
  });

  // Quiet noisy error events to reduce crashes on WAF pages
  page.on('error', () => {});
  page.on('pageerror', () => {});
}

async function dismissConsent(page) {
  // Try common “accept” buttons (button/link/div[role=button]) in visible viewport
  const XPATHS = [
    // generic accept
    "//button[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'accept')]",
    "//button[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'agree')]",
    "//a[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'accept')]",
    "//div[@role='button' and contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'accept')]",
    // cookie specific
    "//*[contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'consent') or contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'consent')]//button",
    "//*[contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'cookie') or contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'cookie')]//button",
  ];
  try {
    for (const xp of XPATHS) {
      const handles = await page.$x(xp);
      for (const h of handles) {
        try { await h.click({ delay: 30 }); await page.waitForTimeout(500); } catch {}
      }
    }
  } catch {}
}

module.exports = { launchBrowser, preparePage, dismissConsent };
