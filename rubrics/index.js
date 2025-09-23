// /rubrics/index.js — single entrypoint that returns the right rubric by siteType
'use strict';

const base      = require('./base');
const b2b       = require('./b2b');
const ecommerce = require('./ecommerce');
const media     = require('./media');

// We expose both a function (primary) and a map (fallback) so the scoring engine
// can resolve this module no matter how it was written to import rubrics.
const RUBRIC_MAP = { base, b2b, ecommerce, media };

/**
 * getRubric(type)
 * @param {'base'|'b2b'|'ecommerce'|'media'} type
 * @returns {object} rubric object that matches scoringEngine’s expectations
 */
function getRubric(type = 'base') {
  return RUBRIC_MAP[type] || RUBRIC_MAP.base;
}

// Make both styles available to any consumer:
// - function style:   require('../rubrics')(siteType)
// - map style:        require('../rubrics').b2b
// - explicit field:   require('../rubrics').map.ecommerce
getRubric.map = RUBRIC_MAP;
getRubric.base = base;
getRubric.b2b = b2b;
getRubric.ecommerce = ecommerce;
getRubric.media = media;

module.exports = getRubric;
