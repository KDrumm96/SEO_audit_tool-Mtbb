// /server/signalmap.js
// Maps rubric-facing keys to the signals emitted by buildStructuredSignals()
// and to Lighthouse categories. Keeps the rest of the signals intact.

'use strict';

/**
 * @param {object} signals - flat map from buildStructuredSignals()
 * @param {object} lh - { performance, accessibility, bestPractices, seo }
 * @returns {object} aligned signal map for scoring
 */
module.exports = function mapSignals(signals = {}, lh = {}) {
  const out = { ...signals };

  // ---- Lighthouse categories (rubrics often use these exact keys) ----
  if (lh && typeof lh === 'object') {
    if (out.pageSpeedScore == null)        out.pageSpeedScore = lh.performance ?? null;
    if (out.accessibilityScore == null)    out.accessibilityScore = lh.accessibility ?? null;
    if (out.bestPracticesScore == null)    out.bestPracticesScore = lh.bestPractices ?? null;
    if (out.seoScore == null)              out.seoScore = lh.seo ?? null;
  }

  // ---- Common aliasing between rubrics and extractor keys ----
  const alias = {
    // Linking
    internalLinking:        'internalLinks',
    externalLinkDiversity:  'externalLinks',

    // Headings / structure
    headerStructure:        'headerFlow',
    headerKeywordUse:       'headerMatch', // heuristic: “keyword used in headings”

    // Meta/schema
    schemaCoverage:         'structuredDataPresent', // boolean presence
    canonicalPresent:       'canonicalPresent',
    robotsTxtPresent:       'robotsTxtPresent',
    sitemapPresent:         'sitemapPresent',
    httpsUsage:             'httpsUsage',
    langAttrPresent:        'langAttrPresent',

    // Content quality
    wordCountNormalized:    'wordCountNormalized',
    densityScore:           'densityScore',
    semanticScore:          'semanticScore',

    // UX
    ctaClarity:             'ctaClarity',
    mobileConsistency:      'mobileConsistency',
    sectionCount:           'sectionCount',
    domDepthRatio:          'domDepthRatio',
  };

  for (const [want, have] of Object.entries(alias)) {
    if (out[want] == null && out[have] != null) {
      out[want] = out[have];
    }
  }

  // If a rubric expects boolean-ish “present” values, normalize a few
  const boolish = ['structuredDataPresent', 'canonicalPresent', 'robotsTxtPresent', 'sitemapPresent', 'httpsUsage', 'langAttrPresent', 'indexable'];
  for (const k of boolish) {
    if (k in out && typeof out[k] === 'number') {
      // clamp to 0/1 if extractor returned 0..1
      out[k] = out[k] >= 0.99 ? 1 : out[k] <= 0 ? 0 : out[k];
    }
  }

  return out;
};
