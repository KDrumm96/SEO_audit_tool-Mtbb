// /server/scoringEngine.js
// Robust rubric loader + scoring engine.
// - Finds rubrics in /rubrics or /rubric (and tolerates a legacy /server/rubric.js)
// - Supports rule types: boolean, normalized, normalized_inverse, scaled_match,
//   count_range (idealRange), numeric_inverse, enum_quality, lighthouse_score
// - Honors per-section weightsBySiteType overrides
// - Accepts Lighthouse categories via opts.lighthouse { performance, accessibility, bestPractices, seo }

'use strict';

// ---------- resilient loader ----------
function tryLoad(paths) {
  for (const p of paths) {
    try {
      const mod = require(p);
      console.log(`[scoring] rubric loaded from: ${require.resolve(p)}`);
      return mod;
    } catch (_) { /* keep trying */ }
  }
  return null;
}

// Attempt common locations relative to /server
const rubricModule =
  tryLoad([
    '../rubrics/index',   // preferred plural /rubrics/index.js
    '../rubrics',         // allow direct map export
    '../rubric/index',    // singular /rubric/index.js
    '../rubric',          // allow direct map/function export
    './rubric',           // legacy /server/rubric.js
  ]) || (() => { throw new Error('No rubric module found under /rubrics or /rubric'); })();

// Normalize how we get a rubric by siteType
function resolveRubric(siteType = 'base') {
  if (typeof rubricModule === 'function') {
    return rubricModule(siteType) || rubricModule('base');
  }
  if (rubricModule && typeof rubricModule === 'object') {
    if (rubricModule[siteType]) return rubricModule[siteType];
    if (rubricModule.base) return rubricModule.base;
  }
  return rubricModule;
}

// ---------- helpers ----------
const clamp01 = (x) =>
  (typeof x === 'number' && isFinite(x)) ? Math.max(0, Math.min(1, x)) : 0;

// Triangle scoring around ideal range [min, max]
function scoreCountRange(raw, idealRange) {
  if (raw == null) return 0;
  if (!Array.isArray(idealRange) || idealRange.length !== 2) return clamp01(raw);
  const [min, max] = idealRange;
  if (typeof raw !== 'number') return 0;
  if (min >= max) return raw >= min ? 1 : 0;
  if (raw >= min && raw <= max) return 1;
  const width = max - min;
  const dist = raw < min ? (min - raw) : (raw - max);
  return clamp01(1 - (dist / width));
}

function scoreRule(rawValue, rule, lh) {
  const t = rule.type || 'normalized';

  // Fill from Lighthouse if requested
  if (rawValue == null && t === 'lighthouse_score' && lh) {
    if (rule.key === 'pageSpeedScore')          rawValue = lh.performance;
    else if (rule.key === 'accessibilityScore') rawValue = lh.accessibility;
    else if (rule.key === 'bestPracticesScore') rawValue = lh.bestPractices;
    else if (rule.key === 'seoScore')           rawValue = lh.seo;
  }

  switch (t) {
    case 'boolean': {
      // Accept true/false, common strings, or numeric (>=0.5 as true)
      if (typeof rawValue === 'boolean') return rawValue ? 1 : 0;
      if (typeof rawValue === 'number')  return rawValue >= 0.5 ? 1 : 0;
      if (typeof rawValue === 'string')  return /^(true|1|yes|y)$/i.test(rawValue) ? 1 : 0;
      return 0;
    }
    case 'normalized':
    case 'scaled_match':
    case 'enum_quality':
      return clamp01(rawValue);

    case 'normalized_inverse':
    case 'numeric_inverse':
      return 1 - clamp01(rawValue);

    case 'count_range':
      return scoreCountRange(rawValue, rule.idealRange);

    case 'lighthouse_score':
      return clamp01(rawValue);

    default:
      return clamp01(rawValue);
  }
}

const DEFAULT_THRESHOLDS = [
  { grade: 'S', minScore: 0.95 },
  { grade: 'A', minScore: 0.85 },
  { grade: 'B', minScore: 0.75 },
  { grade: 'C', minScore: 0.60 },
  { grade: 'D', minScore: 0.40 },
  { grade: 'F', minScore: 0.00 },
];

function getGrade(score, thresholds) {
  const th = Array.isArray(thresholds) && thresholds.length ? thresholds : DEFAULT_THRESHOLDS;
  for (const t of th) {
    if (score >= t.minScore) return t.grade;
  }
  return 'F';
}

// Convert either a flat rubric { thresholds, signals } or sectioned rubric
// into a section map: { [sectionName]: { thresholds, signals, weightsBySiteType? } }
function normalizeRubricShape(rubric) {
  if (!rubric || typeof rubric !== 'object') return {};
  if (Array.isArray(rubric.signals)) {
    return {
      overall: {
        thresholds: rubric.thresholds || DEFAULT_THRESHOLDS,
        signals: rubric.signals,
        weightsBySiteType: rubric.weightsBySiteType || {},
      },
    };
  }
  return rubric;
}

// ---------- main engine ----------
/**
 * @param {Object} signals - flat signal map (ideally 0..1) from buildStructuredSignals
 * @param {string} siteType - 'base' | 'b2b' | 'ecommerce' | 'media'
 * @param {Object} opts - { lighthouse?: { performance, accessibility, bestPractices, seo } }
 * @returns {Object} section -> { total, max, weightedScore, grade, signals[] }
 */
function scoringEngine(signals = {}, siteType = 'base', opts = {}) {
  const rubricRaw = resolveRubric(siteType) || resolveRubric('base');
  const rubric = normalizeRubricShape(rubricRaw);
  const out = {};

  const lh = opts.lighthouse || null;

  for (const sectionName of Object.keys(rubric)) {
    const section = rubric[sectionName] || {};
    const thresholds = section.thresholds || rubricRaw?.thresholds || DEFAULT_THRESHOLDS;
    const weightsByType = section.weightsBySiteType || rubricRaw?.weightsBySiteType || {};
    const typeWeights = weightsByType[siteType] || {};

    const sec = {
      total: 0,
      max: 0,
      weightedScore: 0,
      grade: 'F',
      signals: [],
    };

    const rules = Array.isArray(section.signals) ? section.signals : [];

    for (const rule of rules) {
      const key = rule.key;
      const explicitWeight = (typeof rule.weight === 'number') ? rule.weight : undefined;
      const weight = explicitWeight ?? (typeof typeWeights[key] === 'number' ? typeWeights[key] : 1);

      let raw = signals[key];
      const score = scoreRule(raw, rule, lh);
      const weighted = score * weight;

      sec.total += weighted;
      sec.max += weight;
      sec.signals.push({
        id: key,
        label: rule.name || key,                 // <-- add human label for UI
        value: raw,
        score,
        weight,
        weightedScore: weighted,
        type: rule.type || 'normalized',
        description: rule.description || rule.name || '',
      });
    }

    const normalized = sec.max ? (sec.total / sec.max) : 0;
    sec.weightedScore = normalized;
    sec.grade = getGrade(normalized, thresholds);
    out[sectionName] = sec;
  }

  return out;
}

module.exports = scoringEngine;
