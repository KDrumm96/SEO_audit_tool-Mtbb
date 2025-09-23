// server/server.js — MTBB Audit Server (serves /public and exposes API)
// Env: PORT, CORS_ORIGIN (optional), COHERE_API_KEY (optional for AI)


const path = require('path');
const express = require('express');
const cors = require('cors');

const runAudit = require('./runAudit');

// Be flexible with cohere client shape (function or { generateRecommendations })
let aiRecommend = null;
try {
  const mod = require('./cohereClient');
  aiRecommend =
    typeof mod === 'function'
      ? mod
      : (mod && typeof mod.generateRecommendations === 'function')
      ? mod.generateRecommendations
      : null;
} catch (_) {
  // leave aiRecommend null → route will 503 gracefully
}

const app = express();

/* ---------------- Middleware ---------------- */
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
  })
);

/* ---------------- Static UI (/public) ---------------- */
const staticRoot = path.resolve(__dirname, '..', 'public');
console.log('[static] root =', staticRoot);
app.use(express.static(staticRoot));

/* ---------------- Health ---------------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/* ---------------- Run Audit ---------------- */
app.post('/api/run-audit', async (req, res) => {
  try {
    const { url, siteType } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res
        .status(400)
        .json({ error: true, message: 'Missing or invalid http(s) URL.' });
    }
    if (!siteType) {
      return res.status(400).json({ error: true, message: 'Missing siteType.' });
    }

    const result = await runAudit(url, siteType);
    if (!result || !result.scores) {
      return res
        .status(500)
        .json({ error: true, message: 'Audit produced no scores.' });
    }

    res.json(result);
  } catch (err) {
    console.error('[run-audit] error:', err);
    res
      .status(500)
      .json({ error: true, message: err.message || 'Audit failed unexpectedly.' });
  }
});

/* ---------------- AI Recommendations ---------------- */
app.post('/api/ai-recommendations', async (req, res) => {
  try {
    if (!aiRecommend) {
      return res
        .status(503)
        .json({ error: true, message: 'AI module not available.' });
    }

    const { url, siteType = 'base', scores, structuredSignals, lighthouse } =
      req.body || {};
    if (!url || !scores) {
      return res
        .status(400)
        .json({ error: true, message: 'Body must include url and scores.' });
    }

    const ai = await aiRecommend({
      url,
      siteType,
      scores,
      structuredSignals,
      lighthouse,
    });

    if (ai && (ai.insights || ai.plan || ai.recommendations)) {
      return res.json(ai);
    }
    return res
      .status(500)
      .json({ error: true, message: 'AI failed to generate insights.' });
  } catch (err) {
    console.error('[ai-recommendations] error:', err);
    res
      .status(500)
      .json({ error: true, message: err.message || 'Cohere AI failed.' });
  }
});

/* ---------------- Root route (SPA) ---------------- */
app.get('/', (_req, res) => {
  res.sendFile(path.join(staticRoot, 'index.html'));
});

/* ---------------- Boot ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MTBB audit server running on http://localhost:${PORT}`);
});
