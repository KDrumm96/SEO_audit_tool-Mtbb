// server/generateScreenshot.js

const puppeteer = require('puppeteer');

/**
 * Captures a full-page screenshot and returns it as base64
 * @param {string} url - The URL to screenshot
 * @returns {Promise<string|null>} - base64 encoded PNG or null
 */
async function generateScreenshot(url) {
  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 15000
    });

    const buffer = await page.screenshot({ fullPage: true });
    await browser.close();

    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.warn(`[SCREENSHOT ERROR] ${err.message}`);
    return null;
  }
}

module.exports = generateScreenshot;
