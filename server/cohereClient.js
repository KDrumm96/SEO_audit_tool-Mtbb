// cohereClient.js — Cohere v4+ compatible recommender for MTBB
// Accepts object payload OR legacy positional args, returns { insights, plan } (markdown strings)

const { CohereClient } = require('cohere-ai');

const token = process.env.COHERE_API_KEY;
if (!token) {
  console.warn('[cohereClient] Missing COHERE_API_KEY — AI route will return a 503.');
}

const cohere = token ? new CohereClient({ token }) : null;

// ---------- helpers ----------
function pct(n) {
  return typeof n === 'number' && isFinite(n) ? Math.round(n * 100) : 0;
}

function sectionLabel(k) {
  const map = { seo: 'SEO', performance: 'Performance', accessibility: 'Accessibility', content: 'Content', ux: 'User Experience' };
  return map[k] || (k || '').toUpperCase();
}

function summarizeScores(scores = {}) {
  // Stable order for readability
  const order = ['seo', 'performance', 'accessibility', 'content', 'ux'];
  const keys = Object.keys(scores);
  const rest = keys.filter(k => !order.includes(k)).sort();
  const ordered = order.filter(k => keys.includes(k)).concat(rest);

  let out = '';
  for (const key of ordered) {
    const sec = scores[key] || {};
    const label = sectionLabel(key);
    const grade = sec.grade ?? 'N/A';
    const pctScore = pct(sec.weightedScore ?? 0);
    out += `### ${label}\nGrade: **${grade}** (${pctScore}%)\n`;

    if (Array.isArray(sec.signals) && sec.signals.length) {
      // three lowest signals
      const worst = [...sec.signals]
        .filter(s => typeof s.score === 'number')
        .sort((a, b) => (a.score - b.score))
        .slice(0, 3);

      for (const s of worst) {
        const id = (s.id || 'signal').replace(/_/g, ' ');
        const tip = s.description ? ` — ${s.description}` : '';
        out += `- ${id}: ${pct(s.score)}% (weight: ${s.weight ?? 1})${tip}\n`;
      }
    }
    out += '\n';
  }
  return out.trim();
}

function summarizeLighthouse(lh = {}) {
  const parts = [];
  if (lh.performance != null) parts.push(`Performance: **${pct(lh.performance)}%**`);
  if (lh.accessibility != null) parts.push(`Accessibility: **${pct(lh.accessibility)}%**`);
  if (lh.seo != null) parts.push(`SEO (LH): **${pct(lh.seo)}%**`);
  if (lh.bestPractices != null) parts.push(`Best Practices: **${pct(lh.bestPractices)}%**`);
  return parts.length ? parts.join(' · ') : 'No Lighthouse data available.';
}

function summarizeSignals(sig = {}) {
  const flags = [];
  const yes = (k) => sig[k] === 1 || sig[k] === true;
  const maybe = (k) => typeof sig[k] === 'number' ? pct(sig[k]) + '%' : 'n/a';

  if (yes('httpsUsage')) flags.push('HTTPS enabled');
  if (yes('canonicalPresent')) flags.push('Canonical tag present');
  if (yes('robotsTxtPresent')) flags.push('robots.txt present');
  if (yes('sitemapPresent')) flags.push('sitemap.xml present');
  if (yes('langAttrPresent')) flags.push('HTML lang is set');
  if (yes('structuredDataPresent')) flags.push('Structured data detected');

  const kv = [
    `Alt text coverage: ${maybe('altTextCoverage')}`,
    `Broken links ratio: ${maybe('brokenLinksRatio')}`,
    `Internal links (normalized): ${maybe('internalLinks')}`,
    `External link diversity: ${maybe('externalLinks')}`,
    `Keyword density score: ${maybe('densityScore')}`,
    `Semantic relevance score: ${maybe('semanticScore')}`,
    `Header flow: ${maybe('headerFlow')}`,
  ];

  const bullets = [
    flags.length ? `**Site Hygiene:** ${flags.join(', ')}` : null,
    ...kv
  ].filter(Boolean);

  return bullets.join('\n- ');
}

function splitSections(markdown) {
  // Expect exact H2 headings as instructed; fall back gracefully.
  const md = String(markdown || '');
  const rxInsights = /(^|\n)##\s*Insights\s*\n([\s\S]*?)(?=\n##\s*30[-–\s]?Day\s*Plan\b|\n##\s|$)/i;
  const rxPlan = /(^|\n)##\s*30[-–\s]?Day\s*Plan\s*\n([\s\S]*$)/i;

  const mI = md.match(rxInsights);
  const mP = md.match(rxPlan);

  const insights = (mI ? mI[2] : md).trim();
  const plan = (mP ? mP[2] : '').trim();

  return { insights, plan };
}

// ---------- main ----------
async function generateRecommendations(arg1, arg2, arg3) {
  // Support both shapes:
  // 1) generateRecommendations({ url, siteType, scores, structuredSignals, lighthouse })
  // 2) generateRecommendations(url, siteType, scores)
  let url, siteType, scores, structuredSignals, lighthouse;

  if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1)) {
    ({ url, siteType = 'base', scores = {}, structuredSignals = {}, lighthouse = {} } = arg1);
  } else {
    url = arg1;
    siteType = arg2 || 'base';
    scores = arg3 || {};
    structuredSignals = {};
    lighthouse = {};
  }

  if (!cohere) {
    return { insights: 'AI module not configured (missing COHERE_API_KEY).', plan: '' };
  }

  const scoresMd = summarizeScores(scores);
  const lhMd = summarizeLighthouse(lighthouse);
  const sigMd = summarizeSignals(structuredSignals);

  const system = `You are Mindly, an AI site audit assistant for MTBB. 
- Be concise, tactical, and professional.
- Prioritize the highest-impact fixes first.
- Tailor to the site type: ${siteType}.
- Only include recommendations that are actionable and verifiable from the provided data.`;

  const userContext = `Audit Report for: ${url}

### Section Grades & Weak Points
${scoresMd || '_No scores provided_'}    

### Lighthouse Summary
${lhMd}

### Site Signals
- ${sigMd || '_No structured signals_'}
`;

  const instruction = `Using the context above, produce **two sections** in GitHub-flavored Markdown:

## Insights
- A brief summary of the top issues and the *why*, ranked by impact.
- Map each point to the relevant category (SEO, Performance, Accessibility, Content, UX).

## 30-Day Plan
- A week-by-week plan (Weeks 1–4) with 3–5 steps each.
- Each step must include: the task, the expected outcome, and a simple success metric.
- Keep the total under ~250 lines.`;

  const message = `${userContext}\n\n${instruction}`;

  try {
    const resp = await cohere.chat({
      model: 'command-r-plus',
      message,
      chatHistory: [{ role: 'SYSTEM', message: system }],
      temperature: 0.4,
      maxTokens: 1200
    });

    const text = resp?.text || '';
    const { insights, plan } = splitSections(text);

    // Return in both simple and nested shapes for maximum compatibility with UI
    return {
      insights: insights || 'No insights generated.',
      plan: plan || 'No plan generated.',
      recommendations: {
        insights: insights || 'No insights generated.',
        plan: plan || 'No plan generated.'
      }
    };
  } catch (err) {
    console.error('[cohereClient] error:', err?.message || err);
    return {
      insights: 'AI generation failed.',
      plan: 'AI generation failed.'
    };
  }
}

// Dual export: default function + named to satisfy both import styles
module.exports = generateRecommendations;
module.exports.generateRecommendations = generateRecommendations;
