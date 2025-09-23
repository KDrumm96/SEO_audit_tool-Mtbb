// rubrics/b2b.js — Thin override on top of base rubric (engine-aligned, no placeholders)
// Uses only signals we actually compute today (buildStructuredSignals + Lighthouse categories).

const base = require('../base');

// deep clone (avoid mutating base by reference)
const r = JSON.parse(JSON.stringify(base));

// --- B2B-specific weighting tweaks ---
// Emphasize canonical hygiene + internal linking for multi-page B2B sites
r.seo.weightsBySiteType = {
  ...(r.seo.weightsBySiteType || {}),
  b2b: {
    canonicalPresent: 0.12,
    internalLinks: 0.12
  }
};

// Content: lean harder on semantics and adequate homepage depth
r.content.weightsBySiteType = {
  ...(r.content.weightsBySiteType || {}),
  b2b: {
    semanticScore: 0.30,
    wordCountNormalized: 0.20,
    // modest emphasis on social proof / credibility if present
    trustSignalsPresent: 0.12
  }
};

// UX: prefer clear hierarchy and enough scannable sections
r.ux.weightsBySiteType = {
  ...(r.ux.weightsBySiteType || {}),
  b2b: {
    sectionCount: 0.24,
    headerFlow: 0.18
  }
};

// Performance: balance speed with best-practice hygiene (B2B often ships heavy vendor JS)
r.performance.weightsBySiteType = {
  ...(r.performance.weightsBySiteType || {}),
  b2b: {
    pageSpeedScore: 0.60,
    bestPracticesScore: 0.40
  }
};

// Accessibility inherits base (already 100% of section)

// Export full rubric for this site type
module.exports = r;
