// rubrics/media.js — Thin override on top of base rubric (engine-aligned)
// Focus for media: semantic relevance, readable structure, alt text, external authority, speed, mobile UX.

const base = require('../base');

// deep clone to avoid mutating base by reference
const r = JSON.parse(JSON.stringify(base));

// ---------------- SEO ----------------
// Media sites benefit from richer alt coverage, canonical hygiene, and external authority signals.
r.seo.weightsBySiteType = {
  ...(r.seo.weightsBySiteType || {}),
  media: {
    externalLinks: 0.14,          // citations / outbound authority
    altTextCoverage: 0.12,        // image-heavy articles
    structuredDataPresent: 0.12,  // Article/NewsArticle schema
    canonicalPresent: 0.10,       // prevents duplicate indexation
    metaTagsPresent: 0.12,        // titles/descriptions for share cards
    indexable: 0.12               // guard against accidental noindex
    // remaining keys inherit base weights
  }
};

// -------------- PERFORMANCE --------------
// Fast LCP is critical for content consumption.
r.performance.weightsBySiteType = {
  ...(r.performance.weightsBySiteType || {}),
  media: {
    pageSpeedScore: 0.88,
    bestPracticesScore: 0.12
  }
};

// -------------- ACCESSIBILITY --------------
// Inherit base (100% of section)

// ---------------- CONTENT ----------------
// Heavier emphasis on semantic alignment and clear headings; adequate depth without fluff.
r.content.weightsBySiteType = {
  ...(r.content.weightsBySiteType || {}),
  media: {
    semanticScore: 0.30,
    headerMatch: 0.18,
    wordCountNormalized: 0.16,
    trustSignalsPresent: 0.10,
    densityScore: 0.08
  }
};

// ------------------- UX -------------------
// Prioritize readable structure and mobile comfort; CTAs are less dominant vs ecommerce.
r.ux.weightsBySiteType = {
  ...(r.ux.weightsBySiteType || {}),
  media: {
    domDepthRatio: 0.26,
    mobileConsistency: 0.18,
    sectionCount: 0.16,
    headerFlow: 0.14,
    ctaClarity: 0.16
    // brokenLinksRatio keeps base weight (0.05)
  }
};

module.exports = r;
