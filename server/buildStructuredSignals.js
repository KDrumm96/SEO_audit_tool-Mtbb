// /server/buildStructuredSignals.js
// Deterministic signal extraction from homepage (+ a few pages)
// Focuses on MAIN CONTENT to avoid header/footer noise and improves:
// - Alt text coverage (main area only, ignores decorative/system images)
// - CTA clarity (weighted by anchor/button text + prominence)
// - Trust/Testimonial detection (copy cues + schema.org Review/AggregateRating)
// - Structured data presence (robust ld+json parse incl. arrays/graphs)
// - Section count (RAW integer; rubric uses count_range)
// - Broken-link sampling across a few pages (capped; HEAD only)

'use strict';

const { load } = require('cheerio');
const { URL } = require('url');
const http = require('http');
const https = require('https');

// -------------------- tiny utils --------------------
const STOP = new Set([
  'the','and','for','with','you','your','our','are','this','that','from','have','has','was','were','will',
  'can','not','but','all','any','out','use','how','why','what','about','more','into','over','under','a','an','of','to','in','on','at','by','it','as'
]);
const clamp01 = (x) => (typeof x === 'number' && isFinite(x)) ? Math.max(0, Math.min(1, x)) : 0;

function head(url, timeout = 6000) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.request(url, { method: 'HEAD', timeout }, (res) => resolve(res.statusCode || 0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
      req.on('error', () => resolve(0));
      req.end();
    } catch { resolve(0); }
  });
}

function tokenize(t) {
  return (t || '')
    .toLowerCase()
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

function topKeywords(text, n = 8) {
  const m = new Map();
  for (const w of tokenize(text)) m.set(w, (m.get(w) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size || 1;
  return inter / uni;
}

function presenceScore(hay, needle) {
  if (!needle) return 0;
  const h = (hay || '').toLowerCase();
  if (h === needle) return 1;
  if (h.includes(needle)) return 0.8;
  return needle.split(/\s+/).some((w) => w.length >= 4 && h.includes(w)) ? 0.5 : 0;
}

function rangeScore(x, min, max) {
  if (typeof x !== 'number' || x <= 0) return 0;
  if (min >= max) return x >= min ? 1 : 0;
  if (x >= min && x <= max) return 1;
  const w = max - min;
  const d = x < min ? (min - x) : (x - max);
  return clamp01(1 - d / w);
}

// -------------------- DOM helpers --------------------
function stripBoilerplate($) {
  $('script, style, noscript, svg, canvas, iframe, template').remove();
  $('header, nav, footer, aside').remove();
  // cookie banners / consent wrappers
  $('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i]').remove();
}
const elementText = ($, el) => $(el).text().replace(/\s+/g, ' ').trim();

function extractMainNode($) {
  const pref = $('main, [role="main"], article');
  if (pref.length) return pref.first();

  // Fallback: largest text block among common containers
  let bestEl = null;
  let bestLen = 0;
  $('main, article, section, div').each((_, el) => {
    const t = elementText($, el);
    if (t.length > bestLen) { bestLen = t.length; bestEl = el; }
  });
  return bestEl || $('body').get(0);
}

function computeDomDepth($, el) {
  const kids = $(el).children();
  if (!kids || !kids.length) return 1;
  let m = 0;
  kids.each((_, c) => { const d = computeDomDepth($, c); if (d > m) m = d; });
  return 1 + m;
}

// -------------------- schema detection --------------------
function parseLdJsonBlocks($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    // Some sites embed multiple JSON objects/arrays/graphs; try to parse each safely
    try {
      const json = JSON.parse(raw);
      out.push(json);
    } catch {
      // try tolerant split by }{ edge
      const chunks = raw.split('\n').join(' ').split('}{').map((s, i, arr) => {
        if (arr.length === 1) return s;
        if (i === 0) return s + '}';
        if (i === arr.length - 1) return '{' + s;
        return '{' + s + '}';
      });
      for (const c of chunks) {
        try { out.push(JSON.parse(c)); } catch {}
      }
    }
  });
  return out;
}

function ldContainsTypes(ldBlocks, typeNames) {
  const seek = new Set(typeNames.map((t) => t.toLowerCase()));
  const checkNode = (node) => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(checkNode);
    const at = node['@type'];
    if (typeof at === 'string' && seek.has(at.toLowerCase())) return true;
    if (Array.isArray(at) && at.some((t) => typeof t === 'string' && seek.has(t.toLowerCase()))) return true;
    // @graph and nested objects
    if (Array.isArray(node['@graph']) && node['@graph'].some(checkNode)) return true;
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') { if (checkNode(v)) return true; }
    }
    return false;
  };
  return ldBlocks.some(checkNode);
}

// -------------------- CTA heuristics --------------------
const CTA_WORDS = [
  'get started','get a quote','get quote','request quote','start now','start free','free trial','try free',
  'book now','book a demo','request demo','schedule demo','contact sales','contact us','sign up','sign in',
  'learn more','shop now','buy now','add to cart','subscribe','join now','download','compare plans'
];
function computeCtaClarity($, mainNode) {
  const textFrom = (el) => $(el).text().toLowerCase().replace(/\s+/g, ' ').trim();
  const btns = $(mainNode).find('a,button,[role="button"]');
  if (!btns.length) return 0;

  let hits = 0;
  let strong = 0;
  let aboveFoldHits = 0;

  btns.each((_, el) => {
    const t = textFrom(el);
    if (!t || t.length > 120) return;
    const matched = CTA_WORDS.some((w) => t.includes(w));
    if (matched) {
      hits++;
      // treat anchors/buttons with typical CTA classes as stronger
      const cls = (el.attribs?.class || '').toLowerCase();
      const isPrimary = /(btn(?!-group)|primary|cta|button|hero|call-to-action)/i.test(cls);
      if (isPrimary) strong++;

      // rough "above the fold": scan if element appears in first 1500 chars of main HTML
      // (cheap heuristic without layout/positions)
      const html = $(mainNode).html() || '';
      const pos = html.toLowerCase().indexOf(t);
      if (pos >= 0 && pos < 1500) aboveFoldHits++;
    }
  });

  if (!hits) return 0;

  // Score blend: base presence + strength + above-the-fold bonus
  // Normalize by common ranges (hits up to 4; strong up to 2; aboveFold up to 2)
  const presence = Math.min(1, hits / 2);
  const strength = Math.min(1, strong / 2);
  const fold     = Math.min(1, aboveFoldHits / 2);
  return clamp01(0.6 * presence + 0.25 * strength + 0.15 * fold);
}

// -------------------- main extractor --------------------
module.exports = async function buildStructuredSignals(homepage, pages = []) {
  if (!homepage || !homepage.url || !homepage.html) {
    throw new Error('buildStructuredSignals: homepage {url, html} required');
  }

  const $ = load(homepage.html);
  const homeURL = new URL(homepage.url);
  const origin  = homeURL.origin;
  const host    = homeURL.host;

  // Clean up & pin main node
  stripBoilerplate($);
  const mainNode = extractMainNode($);
  const mainText = elementText($, mainNode);
  const wordCount = Math.max(1, mainText.split(/\s+/).length);

  // Title/meta/headers (from head + visible headings)
  const title = $('title').first().text().trim();
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() || '';
  const hText = $('h1, h2, h3').map((_, el) => $(el).text().toLowerCase().trim()).get();

  // Keyword modeling (mainText heavily weighted)
  const kwsTitle   = topKeywords(title, 5);
  const kwsHeaders = topKeywords(hText.join(' '), 10);
  const kwsBody    = topKeywords(mainText.slice(0, 6000), 12);
  const topicKeywords = [...new Set([...kwsTitle, ...kwsHeaders, ...kwsBody])].slice(0, 8);
  const primaryKeyword = topicKeywords[0] || '';

  const titleMatch  = presenceScore(title, primaryKeyword);
  const metaMatch   = topicKeywords.length ? topicKeywords.filter(k => metaDesc.toLowerCase().includes(k)).length / topicKeywords.length : 0;
  const headerMatch = hText.length ? hText.filter(h => topicKeywords.some(k => h.includes(k))).length / hText.length : 0;

  const hits = primaryKeyword ? ((mainText.match(new RegExp(primaryKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length) : 0;
  const density = hits / wordCount;
  const densityScore = density >= 0.01 && density <= 0.03
    ? 1
    : density < 0.01
      ? clamp01(density / 0.01)
      : clamp01(0.03 / density);

  const semanticScore = jaccard(topicKeywords, topKeywords(mainText.slice(0, 1200), 10));

  // ---- UX / layout ----
  // Section count is RAW integer; rubric uses count_range([4,12])
  let sectionCount = $(mainNode).find('section').length;
  if (!sectionCount) {
    const approx = $(mainNode).find('div, section').length;
    sectionCount = Math.max(1, Math.round(approx / 6));
  }

  const totalNodes = $('*').length || 1;
  const depth = computeDomDepth($, $('body').get(0) || 'body');
  const domDepthRatio = 1 - Math.min(1, depth / totalNodes);

  const tags = $('h1,h2,h3').map((_,el)=>parseInt($(el)[0].tagName.substring(1),10)).get();
  const hasH1 = tags.includes(1);
  const nonDec = tags.every((v, i, a) => i === 0 || v >= a[i - 1]);
  const headerFlow = !hasH1 ? 0 : (nonDec ? 1 : 0.5);
  const h1Single = $('h1').length === 1 ? 1 : 0;

  // CTA clarity (0..1)
  const ctaClarity = computeCtaClarity($, mainNode);

  const mobileConsistency = $('meta[name="viewport"]').attr('content') ? 1 : 0.6;

  // ---- SEO / platform ----
  const hasTitle = !!$('title').length;
  const hasDesc  = !!$('meta[name="description"]').length;
  const metaTagsPresent = hasTitle && hasDesc ? 1 : (hasTitle || hasDesc ? 0.5 : 0);

  // Alt coverage (MAIN area only; ignore likely decorative/system images)
  const imgs = $(mainNode).find('img').get();
  const isInformative = (imgEl) => {
    const $img = $(imgEl);
    const alt = ($img.attr('alt') || '').trim();
    const role = ($img.attr('role') || '').toLowerCase();
    const ariaHidden = ($img.attr('aria-hidden') || '').toLowerCase() === 'true';
    const classes = ($img.attr('class') || '').toLowerCase();
    const src = ($img.attr('src') || '').toLowerCase();
    // decorative/system heuristics
    if (ariaHidden || role === 'presentation' || role === 'none') return false;
    if (classes.includes('decorative') || classes.includes('bg-') || classes.includes('icon')) return false;
    if (/\b(sprite|placeholder|spacer|tracking|pixel)\b/.test(classes + ' ' + src)) return false;
    if (classes.includes('logo') && !alt) return false; // logos must be named to count
    return true;
  };
  const informativeImgs = imgs.filter(isInformative);
  const withAlt = informativeImgs.filter((img) => {
    const alt = ($(img).attr('alt') || '').trim();
    const aria = ($(img).attr('aria-label') || '').trim();
    const titleAttr = ($(img).attr('title') || '').trim();
    return (alt && alt.length >= 3) || aria || titleAttr;
  });
  const altTextCoverage = informativeImgs.length ? (withAlt.length / informativeImgs.length) : 1;

  const headerStructure = headerFlow;

  // Internal/external links (normalize by main word count to avoid nav bias)
  const anchors = $('a[href]').map((_, a) => $(a).attr('href')).get().filter(Boolean);
  const normalized = anchors
    .map((href) => { try { return new URL(href, homepage.url); } catch { return null; } })
    .filter(Boolean);
  const internalLinksCount = normalized.filter((u) => u.host === host).length;
  const externalHosts = new Set(normalized.filter((u) => u.host !== host).map((u) => u.host));
  const internalLinks = Math.min(1, internalLinksCount / Math.max(1, Math.round(wordCount / 200)));
  const externalLinks = Math.min(1, externalHosts.size / 5);

  const robotsMeta = $('meta[name="robots"]').attr('content') || '';
  const indexable = !/noindex/i.test(robotsMeta);

  const ldBlocks = parseLdJsonBlocks($);
  const structuredDataPresent =
    ldBlocks.length > 0 || $('[itemscope]').length > 0 ? 1 : 0;

  // Trust/testimonials (keywords OR schema Review/AggregateRating on home,
  // plus a light scan of a few more pages)
  const trustRegex = /(review|reviews|testimonial|testimonials|case study|client stories|what our customers say|rating|★★★★★|stars?)/i;
  let trustSignalsPresent = trustRegex.test(mainText) ? 1 : 0;
  if (!trustSignalsPresent) {
    if (ldContainsTypes(ldBlocks, ['Review', 'AggregateRating'])) trustSignalsPresent = 1;
  }
  if (!trustSignalsPresent && Array.isArray(pages) && pages.length) {
    for (const p of pages.slice(0, 4)) {
      const $p = load(p.html || '');
      const m = elementText($p, 'body');
      if (trustRegex.test(m)) { trustSignalsPresent = 1; break; }
      const ld = parseLdJsonBlocks($p);
      if (ldContainsTypes(ld, ['Review', 'AggregateRating'])) { trustSignalsPresent = 1; break; }
    }
  }

  const canonicalPresent = $('link[rel="canonical"]').length > 0 ? 1 : 0;
  const httpsUsage = homeURL.protocol === 'https:' ? 1 : 0;
  const langAttrPresent = !!$('html').attr('lang') ? 1 : 0;

  // robots.txt & sitemap.xml via HEAD (best-effort)
  const [robotsCode, sitemapCode] = await Promise.all([
    head(new URL('/robots.txt', origin).href),
    head(new URL('/sitemap.xml', origin).href),
  ]);
  const robotsTxtPresent = (robotsCode && robotsCode < 400) ? 1 : 0;
  const sitemapPresent   = (sitemapCode && sitemapCode < 400) ? 1 : 0;

  // Word count quality (ideal 300–1200) — based on MAIN content only
  const wordCountNormalized = rangeScore(wordCount, 300, 1200);

  // Broken links sampling across a few pages (capped for speed)
  const sample = [];
  for (const p of (pages || []).slice(0, 6)) {
    const $p = load(p.html || '');
    stripBoilerplate($p);
    const hrefs = $p('a[href]').map((_, a) => $p(a).attr('href')).get().filter(Boolean);
    for (const h of hrefs) {
      try {
        const u = new URL(h, p.url);
        if (/^https?:/i.test(u.href)) sample.push(u.href);
        if (sample.length >= 20) break;
      } catch {}
    }
    if (sample.length >= 20) break;
  }
  const uniq = [...new Set(sample)];
  let broken = 0, checked = 0;
  for (const u of uniq) {
    const code = await head(u);
    checked++; if (!code || code >= 400) broken++;
    if (checked >= 12) break;
  }
  const brokenLinksRatio = checked ? clamp01(broken / checked) : 0;

  // Final flat map (keys align with rubric)
  return {
    // relevance / content
    titleMatch, metaMatch, headerMatch, densityScore, semanticScore,

    // ux (note: sectionCount is RAW)
    sectionCount, domDepthRatio, headerFlow, h1Single, ctaClarity, mobileConsistency,

    // seo
    metaTagsPresent, altTextCoverage, headerStructure, internalLinks, externalLinks, indexable,

    // extras used by rubric or AI layer
    structuredDataPresent,
    trustSignalsPresent,
    canonicalPresent,
    httpsUsage,
    langAttrPresent,
    robotsTxtPresent,
    sitemapPresent,
    wordCountNormalized,
    brokenLinksRatio,

    // debug (handy to surface in Insights if needed)
    _derived: { primaryKeyword, topicKeywords, wordCount }
  };
};
