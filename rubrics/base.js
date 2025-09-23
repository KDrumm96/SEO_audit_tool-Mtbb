// rubric/base.js — MTBB base rubric (engine-aligned)

const sharedThresholds = [
  { grade: "S", minScore: 0.95 },
  { grade: "A", minScore: 0.85 },
  { grade: "B", minScore: 0.75 },
  { grade: "C", minScore: 0.60 },
  { grade: "D", minScore: 0.40 },
  { grade: "F", minScore: 0.00 }
];

module.exports = {
  // ------------ SEO ------------
  seo: {
    label: "Search Engine Optimization",
    thresholds: sharedThresholds,
    signals: [
      { name: "Indexing Readiness",        key: "indexable",              type: "boolean",        weight: 0.15 },
      { name: "HTTPS Usage",                key: "httpsUsage",             type: "boolean",        weight: 0.10 },
      { name: "Canonical Present",          key: "canonicalPresent",       type: "boolean",        weight: 0.08 },
      { name: "HTML lang Present",          key: "langAttrPresent",        type: "boolean",        weight: 0.05 },
      { name: "robots.txt Present",         key: "robotsTxtPresent",       type: "boolean",        weight: 0.05 },
      { name: "sitemap.xml Present",        key: "sitemapPresent",         type: "boolean",        weight: 0.05 },
      { name: "Meta Tags Present",          key: "metaTagsPresent",        type: "normalized",     weight: 0.12 }, // tri-state
      { name: "Alt Text Coverage",          key: "altTextCoverage",        type: "normalized",     weight: 0.10 },
      { name: "Header Structure",           key: "headerStructure",        type: "enum_quality",   weight: 0.10 },
      { name: "H1 Is Single",               key: "h1Single",               type: "enum_quality",   weight: 0.05 },
      { name: "Internal Linking (norm.)",   key: "internalLinks",          type: "normalized",     weight: 0.10 },
      { name: "External Link Diversity",    key: "externalLinks",          type: "normalized",     weight: 0.05 },
      { name: "Structured Data Present",    key: "structuredDataPresent",  type: "boolean",        weight: 0.10 }
    ],
    weightsBySiteType: {
      ecommerce: { structuredDataPresent: 0.14, internalLinks: 0.12, altTextCoverage: 0.12 },
      b2b:       { canonicalPresent: 0.10, internalLinks: 0.11 },
      media:     { externalLinks: 0.08,   altTextCoverage: 0.12 }
    }
  },

  // -------- Performance (LH only) --------
  performance: {
    label: "Performance",
    thresholds: sharedThresholds,
    signals: [
      // Use Lighthouse Performance exclusively so Snapshot ≡ Grade
      { name: "Page Speed", key: "pageSpeedScore", type: "lighthouse_score", weight: 1.0 }
    ]
    // (No weightsBySiteType needed; weight is 1.0 everywhere)
  },

  // ------- Accessibility -------
  accessibility: {
    label: "Accessibility",
    thresholds: sharedThresholds,
    signals: [
      { name: "Accessibility (LH)", key: "accessibilityScore",  type: "lighthouse_score", weight: 1.0 }
    ]
  },

  // ---------- Content ----------
  content: {
    label: "Content Quality & Relevance",
    thresholds: sharedThresholds,
    signals: [
      { name: "Title Tag Match",        key: "titleMatch",          type: "scaled_match",  weight: 0.20 },
      { name: "Meta Description Match", key: "metaMatch",           type: "scaled_match",  weight: 0.15 },
      { name: "Header Keyword Use",     key: "headerMatch",         type: "scaled_match",  weight: 0.15 },
      { name: "Semantic Relevance",     key: "semanticScore",       type: "normalized",    weight: 0.25 },
      { name: "Keyword Density",        key: "densityScore",        type: "normalized",    weight: 0.10 },
      { name: "Word Count (Home)",      key: "wordCountNormalized", type: "normalized",    weight: 0.15 },
      { name: "Trust Signals Present",  key: "trustSignalsPresent", type: "boolean",       weight: 0.10 }
    ]
  },

  // ------------- UX -------------
  ux: {
    label: "User Experience",
    thresholds: sharedThresholds,
    signals: [
      { name: "Section Count (Home)",   key: "sectionCount",     type: "count_range",     idealRange: [4, 12], weight: 0.20 },
      { name: "DOM Depth Ratio",        key: "domDepthRatio",    type: "normalized",                           weight: 0.20 },
      { name: "Header Hierarchy Flow",  key: "headerFlow",       type: "enum_quality",                          weight: 0.15 },
      { name: "CTA Clarity",            key: "ctaClarity",       type: "normalized",                             weight: 0.25 },
      { name: "Mobile Consistency",     key: "mobileConsistency",type: "normalized",                             weight: 0.15 },
      { name: "Broken Links (inverse)", key: "brokenLinksRatio", type: "numeric_inverse",                        weight: 0.05 }
    ]
  }
};
