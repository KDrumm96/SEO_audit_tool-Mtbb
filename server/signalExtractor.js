const { default: lighthouse } = require("lighthouse");
const { URL } = require("url");
const chromeLauncher = require("chrome-launcher");
const puppeteer = require("puppeteer");
const rubric = require("./rubric");
const { getSemanticScore } = require("./cohereClient");

async function getSignalsForURL(url, keywords = []) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const signals = {
    keyword_matching: {},
    layout_quality: {},
    seo: {},
    performance: {},
    mobile_ux: {},
    meta: {}
  };

  const primaryKeyword = keywords[0] || "";
  const allKeywords = keywords.length ? keywords : primaryKeyword.split(" ");

  // --- Keyword Matching
  const pageTitle = await page.title();
  const lcTitle = pageTitle.toLowerCase();
  const lcKeyword = primaryKeyword.toLowerCase();

  let titleMatch = 0;
  if (lcTitle === lcKeyword) titleMatch = 1.0;
  else if (lcTitle.includes(lcKeyword)) titleMatch = 0.8;
  else if (lcKeyword.split(" ").some(word => lcTitle.includes(word))) titleMatch = 0.5;
  signals.keyword_matching.titleMatch = titleMatch;

  const metaDesc = await page.$eval('meta[name="description"]', el => el.content || "").catch(() => "");
  const metaMatchCount = allKeywords.filter(k => metaDesc.toLowerCase().includes(k.toLowerCase())).length;
  const metaMatch = metaMatchCount / allKeywords.length || 0;
  signals.keyword_matching.metaMatch = metaMatch;

  const headers = await page.$$eval("h1,h2,h3", els => els.map(el => el.textContent.toLowerCase()));
  const headerMatches = headers.filter(h => allKeywords.some(k => h.includes(k)));
  const headerMatch = headers.length ? headerMatches.length / headers.length : 0;
  signals.keyword_matching.headerMatch = headerMatch;

  const bodyText = await page.$eval("body", el => el.innerText.toLowerCase());
  const wordCount = bodyText.split(/\s+/).length;
  const keywordHits = (bodyText.match(new RegExp(lcKeyword, "gi")) || []).length;
  const density = keywordHits / wordCount;
  const densityScore = (density >= 0.01 && density <= 0.03) ? 1.0 :
                       (density < 0.01 ? density / 0.01 : (0.03 / density));
  signals.keyword_matching.densityScore = Math.min(1, densityScore);

  const trimmedBody = bodyText.split(/\s+/).slice(0, 600).join(" ");
  const semanticScore = await getSemanticScore(trimmedBody, primaryKeyword);
  signals.keyword_matching.semanticScore = semanticScore;

  // --- Meta info for AI
  signals.meta = {
    title: pageTitle,
    description: metaDesc,
    headers: headers.slice(0, 5).join(" • "),
    keyword: primaryKeyword
  };

  // --- Layout Quality
  const sectionCount = await page.$$eval("section", els => els.length);
  let sectionScore = 1.0;
  if (sectionCount < 4) sectionScore = sectionCount / 4;
  else if (sectionCount > 10) sectionScore = 10 / sectionCount;
  signals.layout_quality.sectionCount = Math.min(1, sectionScore);

  const domDepthRatio = await page.evaluate(() => {
    function getDepth(node) {
      if (!node.children || node.children.length === 0) return 1;
      return 1 + Math.max(...Array.from(node.children).map(getDepth));
    }
    const totalNodes = document.querySelectorAll("*").length;
    const depth = getDepth(document.body);
    return depth / totalNodes;
  });
  signals.layout_quality.domDepthRatio = 1 - domDepthRatio;

  const headerFlow = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll("h1, h2, h3"));
    const tagOrder = headers.map(h => parseInt(h.tagName.substring(1)));
    const hasH1 = tagOrder.includes(1);
    const isSequential = tagOrder.every((val, i, arr) => i === 0 || val >= arr[i - 1]);
    if (!hasH1) return 0.0;
    if (isSequential) return 1.0;
    return 0.5;
  });
  signals.layout_quality.headerFlow = headerFlow;

  const hasCTA = await page.evaluate(() => {
    const cta = Array.from(document.querySelectorAll("a, button")).filter(el =>
      el.innerText.match(/(get|buy|start|join|subscribe|contact|sign up)/i)
    );
    return cta.length > 0 ? 1.0 : 0.0;
  });
  signals.layout_quality.ctaClarity = hasCTA;
  signals.layout_quality.mobileConsistency = 0.8;

  // --- SEO
  const [hasTitleTag, hasMeta] = await page.evaluate(() => {
    const title = document.querySelector("title");
    const meta = document.querySelector('meta[name="description"]');
    return [!!title, !!meta];
  });
  signals.seo.metaTagsPresent = (hasTitleTag && hasMeta) ? 1.0 : (hasTitleTag || hasMeta) ? 0.5 : 0.0;

  const altTextCoverage = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    if (!imgs.length) return 1.0;
    const withAlt = imgs.filter(img => img.alt && img.alt.trim().length > 3);
    return withAlt.length / imgs.length;
  });
  signals.seo.altTextCoverage = altTextCoverage;
  signals.seo.headerStructure = headerFlow;

  const internalLinkScore = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a")).filter(a =>
      a.href.includes(location.hostname)
    );
    const text = document.body.innerText;
    const wordCount = text.split(/\s+/).length;
    return Math.min(1.0, links.length / (wordCount / 200));
  });
  signals.seo.internalLinks = internalLinkScore;

  const externalLinkScore = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a"));
    const externalLinks = anchors.filter(a => {
      try {
        return a.href.startsWith("http") && !a.href.includes(location.hostname);
      } catch {
        return false;
      }
    });
    const uniqueHosts = new Set(externalLinks.map(link => new URL(link.href).hostname));
    return Math.min(1.0, uniqueHosts.size / 5);
  });
  signals.seo.externalLinks = externalLinkScore;

  const indexable = await page.evaluate(() => {
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (!robotsMeta) return 1.0;
    return robotsMeta.content.includes("noindex") ? 0.0 : 1.0;
  });
  signals.seo.indexable = indexable;

  // --- Performance + Mobile (via Lighthouse)
  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless"] });
  const options = {
    logLevel: "info",
    output: "json",
    onlyCategories: ["performance", "accessibility", "seo"],
    port: chrome.port
  };
  const runnerResult = await lighthouse(url, options);
  const lh = runnerResult.lhr;

  signals.performance.fcp = lh.audits["first-contentful-paint"]?.score ?? 0;
  signals.performance.lcp = lh.audits["largest-contentful-paint"]?.score ?? 0;
  signals.performance.cls = lh.audits["cumulative-layout-shift"]?.score ?? 0;

  const blockingMs = lh.audits["total-blocking-time"]?.numericValue ?? 0;
  signals.performance.blockingTime =
    blockingMs < 200 ? 1.0 :
    blockingMs < 600 ? (600 - blockingMs) / 400 : 0.0;

  const lazyScore = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    if (!imgs.length) return 1.0;
    const lazy = imgs.filter(img => img.loading === "lazy");
    return lazy.length / imgs.length;
  });
  signals.performance.lazyLoad = Math.min(1.0, lazyScore);

  // Mobile UX (reuse safe values)
  signals.mobile_ux.viewportTag = await page.evaluate(() =>
    !!document.querySelector('meta[name="viewport"]') ? 1.0 : 0.0
  );
  signals.mobile_ux.touchSpacing = lh.audits["tap-targets"]?.score ?? 0;
  signals.mobile_ux.mobileCLS = lh.audits["cumulative-layout-shift"]?.score ?? 0;
  signals.mobile_ux.aiMobileLayout = 0.8;
  signals.mobile_ux.manualZoomScroll = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth ? 0.0 : 1.0
  );

  await browser.close();
  await chrome.kill();
  return signals;
}

module.exports = { getSignalsForURL };
