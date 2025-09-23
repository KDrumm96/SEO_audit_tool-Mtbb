// rubric/base.js — MTBB base rubric (aligned to buildStructuredSignals + Lighthouse)

const sharedThresholds = [
  { grade: "S", minScore: 0.95 },
  { grade: "A", minScore: 0.85 },
  { grade: "B", minScore: 0.75 },
  { grade: "C", minScore: 0.60 },
  { grade: "D", minScore: 0.40 },
  { grade: "F", minScore: 0.00 }
];

module.exports = {
  /* ========== SEO ========== */
  seo: {
    label: "Search Engine Optimization",
    thresholds: sharedThresholds,
    // Only signals your extractor actually emits, with scorer-supported types
    signals: [
      { name: "Indexing Readiness",     key: "indexable",             type: "boolean",    weight: 0.18 },
      { name: "Meta Tags Present",      key: "metaTagsPresent",       type: "boolean",    weight: 0.14 },
      { name: "Alt Text Coverage",      key: "altTextCoverage",       type: "normalized", weight: 0.12 },
      { name: "Header Structure",       key: "headerStructure",       type: "enum_quality", weight: 0.10 },
      { name: "Internal Linking",       key: "internalLinks",         type: "normalized", weight: 0.16 },
      { name: "External Link Diversity",key: "externalLinks",         type: "normalized", weight: 0.08 },
      { name: "Structured Data Present",key: "structuredDataPresent", type: "boolean",    weight: 0.12 },
      { name: "Trust Signals Present",  key: "trustSignalsPresent",   type: "boolean",    weight: 0.10 }
    ]
  },

  /* ========== PERFORMANCE (Lighthouse) ========== */
  performance: {
    label: "Performance",
    thresholds: sharedThresholds,
    // These are filled by scoringEngine(..., { lighthouse })
    signals: [
      { name: "Page Speed",        key: "pageSpeedScore",       type: "lighthouse_score", weight: 0.70 },
      { name: "Best Practices",    key: "bestPracticesScore",   type: "lighthouse_score", weight: 0.30 }
    ]
  },

  /* ========== ACCESSIBILITY (Lighthouse) ========== */
  accessibility: {
    label: "Accessibility",
    thresholds: sharedThresholds,
    signals: [
      { name: "Accessibility",     key: "accessibilityScore",   type: "lighthouse_score", weight: 1.0 }
    ]
  },

  /* ========== CONTENT & RELEVANCE ========== */
  content: {
    label: "Content & Relevance",
    thresholds: sharedThresholds,
    // ‘scaled_match’ and ‘normalized’ are supported; removed unsupported ‘ai_score’
    signals: [
      { name: "Title Tag Match",        key: "titleMatch",       type: "scaled_match",  weight: 0.20 },
      { name: "Meta Description Match", key: "metaMatch",        type: "scaled_match",  weight: 0.15 },
      { name: "Header Keyword Use",     key: "headerMatch",      type: "scaled_match",  weight: 0.15 },
      { name: "Semantic Relevance",     key: "semanticScore",    type: "normalized",    weight: 0.25 },
      { name: "Keyword Density",        key: "densityScore",     type: "normalized",    weight: 0.10 },
      { name: "Trust Signals Present",  key: "trustSignalsPresent", type: "boolean",    weight: 0.15 }
    ]
  },

  /* ========== USER EXPERIENCE ========== */
  ux: {
    label: "User Experience",
    thresholds: sharedThresholds,
    signals: [
      // Provide idealRange for count_range; 4–12 sections is a good baseline
      { name: "Section Count (Home)",   key: "sectionCount",      type: "count_range",     idealRange: [4, 12], weight: 0.20 },
      // domDepthRatio from extractor is already “higher is better” → normalized (not inverse)
      { name: "DOM Depth Ratio",        key: "domDepthRatio",     type: "normalized",      weight: 0.20 },
      { name: "Header Hierarchy Flow",  key: "headerFlow",        type: "enum_quality",    weight: 0.15 },
      { name: "CTA Clarity",            key: "ctaClarity",        type: "normalized",      weight: 0.25 },
      { name: "Mobile Consistency",     key: "mobileConsistency", type: "normalized",      weight: 0.15 },
      // Broken links: lower is better → numeric_inverse
      { name: "Broken Links (inverse)", key: "brokenLinksRatio",  type: "numeric_inverse", weight: 0.05 }
    ]
  }
};
