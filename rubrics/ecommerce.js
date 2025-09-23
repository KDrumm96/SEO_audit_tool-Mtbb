// rubrics/ecommerce.js — Thin override on top of base rubric (engine-aligned)
// Focus: structured data, internal linking, alt text, speed, mobile UX, CTA clarity.

const base = require('../base');

// deep clone to avoid mutating base by reference
const r = JSON.parse(JSON.stringify(base));

// ---------------- SEO ----------------
// E-commerce sites rely heavily on product schema, robust internal linking, and image alt coverage.
r.seo.weightsBySiteType = {
  ...(r.seo.weightsBySiteType || {}),
  ecommerce: {
    structuredDataPresent: 0.16,   // product/offer schema is critical
    internalLinks: 0.12,           // category/product discoverability
    altTextCoverage: 0.12,         // image-heavy catalogs
    indexable: 0.14,               // make sure nothing blocks crawling
    metaTagsPresent: 0.12          // titles/descriptions at scale
    // remaining keys inherit base weights
  }
};

// -------------- PERFORMANCE --------------
// Speed directly impacts conversion. Favor page speed more heavily.
r.performance.weightsBySiteType = {
  ...(r.performance.weightsBySiteType || {}),
  ecommerce: {
    pageSpeedScore: 0.85,
    bestPracticesScore: 0.15
  }
};

// -------------- ACCESSIBILITY --------------
// Inherit base (already 100%). Many product templates benefit from proper semantics.

// ---------------- CONTENT ----------------
// Trust indicators and concise, relevant copy; semantics still matter, density slightly de-emphasized.
r.content.weightsBySiteType = {
  ...(r.content.weightsBySiteType || {}),
  ecommerce: {
    trustSignalsPresent: 0.18,     // reviews, ratings, guarantees
    semanticScore: 0.24,           // align copy with shopper intent
    headerMatch: 0.16,             // category/product keyword cues
    wordCountNormalized: 0.12,     // enough copy for context, not walls of text
    densityScore: 0.08             // prevent keyword stuffing on category/home
  }
};

// ------------------- UX -------------------
// Clear CTAs and mobile ergonomics carry more weight for checkout flows.
r.ux.weightsBySiteType = {
  ...(r.ux.weightsBySiteType || {}),
  ecommerce: {
    ctaClarity: 0.34,
    mobileConsistency: 0.20
    // other weights (sectionCount, domDepthRatio, headerFlow, brokenLinksRatio)
    // inherit base unless overridden
  }
};

module.exports = r;
