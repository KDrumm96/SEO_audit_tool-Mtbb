// audit-ui.js — Single, safe entry (ES module) — Snapshot now mirrors server scores
import { renderGradeCards } from './gradesTab.js';

document.addEventListener('DOMContentLoaded', () => {
  // ---------- DOM ----------
  const siteUrlInput        = document.getElementById('siteUrlInput');
  const siteTypeSelect      = document.getElementById('siteTypeSelect');
  const startButton         = document.getElementById('startButton');
  const themeToggle         = document.getElementById('themeToggle');
  const exportButton        = document.getElementById('exportButton');

  const loadingSection      = document.getElementById('loadingSection');
  const resultsSection      = document.getElementById('resultsSection');
  const errorMessage        = document.getElementById('errorMessage');

  const screenshotImg       = document.getElementById('screenshotImg');
  const screenshotCaption   = document.getElementById('screenshotCaption');

  const snapshotSEO         = document.getElementById('snapshotSEO');
  const snapshotUX          = document.getElementById('snapshotUX');
  const snapshotPerformance = document.getElementById('snapshotPerformance');

  const scoreCards          = document.getElementById('scoreCards');
  const insightsContent     = document.getElementById('insightsContent');
  const planContent         = document.getElementById('planContent');

  // Markdown parser (robust to different marked builds or absence)
  const parseMd =
    (globalThis.marked && typeof globalThis.marked.parse === 'function')
      ? (md) => globalThis.marked.parse(md)
      : (typeof globalThis.marked === 'function')
        ? (md) => globalThis.marked(md)
        : (md) => md;

  // ---------- Tabs ----------
  function activateTab(tabId) {
    document.querySelectorAll('.tab-link').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== tabId);
    });
  }

  document.querySelectorAll('.tab-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      activateTab(btn.dataset.tab);
    });
  });

  // ---------- Theme ----------
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
  });

  // ---------- Export ----------
  exportButton.addEventListener('click', () => window.print());

  // ---------- Helpers ----------
  function resetUI() {
    errorMessage.classList.add('hidden');
    resultsSection.classList.add('hidden');
    loadingSection.classList.add('hidden');

    screenshotImg.src = 'assets/placeholder.svg';
    screenshotCaption.textContent = 'Waiting for screenshot...';
    snapshotSEO.textContent = '--';
    snapshotUX.textContent = '--';
    snapshotPerformance.textContent = '--';
    scoreCards.innerHTML = '';
    insightsContent.innerHTML = '';
    planContent.innerHTML = '';
  }

  function showError(msg) {
    loadingSection.classList.add('hidden');
    errorMessage.textContent = `🚫 ${msg}`;
    errorMessage.classList.remove('hidden');
  }

  // ---------- Results pipeline ----------
  async function handleAuditResults(auditData, url, siteType) {
    // Screenshot
    if (auditData.screenshotBase64) {
      screenshotImg.src = `data:image/png;base64,${auditData.screenshotBase64}`;
      screenshotCaption.textContent = `Scanned: ${url}`;
    } else {
      screenshotImg.src = 'assets/placeholder.svg';
      screenshotCaption.textContent = 'Screenshot not available.';
    }

    // Snapshot KPIs — prefer server rubric scores so Snapshot == Grades
    const s = auditData.scores || {};
    const lh = auditData.lighthouse || {};

    const snapSeo =
      typeof s.seo?.weightedScore === 'number'
        ? Math.round(s.seo.weightedScore * 100)
        : (lh.seo != null ? Math.round(lh.seo * 100) : null);

    const snapPerf =
      typeof s.performance?.weightedScore === 'number'
        ? Math.round(s.performance.weightedScore * 100)
        : (lh.performance != null ? Math.round(lh.performance * 100) : null);

    const snapUx =
      typeof s.ux?.weightedScore === 'number'
        ? Math.round(s.ux.weightedScore * 100)
        : (lh.accessibility != null && lh.bestPractices != null
            ? Math.round(((lh.accessibility + lh.bestPractices) / 2) * 100)
            : null);

    snapshotSEO.textContent = snapSeo ?? '--';
    snapshotPerformance.textContent = snapPerf ?? '--';
    snapshotUX.textContent = snapUx ?? '--';

    // Grades
    renderGradeCards(s);

    // AI Recommendations (non-blocking for Grades)
    try {
      const aiRes = await fetch('/api/ai-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          siteType,
          scores: s,
          structuredSignals: auditData.structuredSignals,
          lighthouse: lh
        })
      });

      if (!aiRes.ok) throw new Error(`${aiRes.status} ${aiRes.statusText}`);
      const aiData = await aiRes.json();

      const insights = aiData.recommendations?.insights || aiData.insights || '';
      const plan = aiData.recommendations?.plan || aiData.plan || '';

      insightsContent.innerHTML = insights ? parseMd(insights) : '<p>No insights returned from AI.</p>';
      planContent.innerHTML = plan ? parseMd(plan) : '<p>No plan returned from AI.</p>';
    } catch (err) {
      insightsContent.innerHTML = `<p class="error">❌ AI error: ${err.message}</p>`;
      planContent.innerHTML = '<p class="error">Plan could not be generated.</p>';
    }
  }

  // ---------- Start Audit ----------
  startButton.addEventListener('click', async () => {
    let url = siteUrlInput.value.trim();
    if (!url) return showError('Please enter a valid URL.');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    const siteType = siteTypeSelect.value;
    if (!siteType) return showError('Please select a site type.');

    resetUI();
    loadingSection.classList.remove('hidden');

    try {
      const res = await fetch('/api/run-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, siteType })
      });
      if (!res.ok) throw new Error(`Audit failed: ${res.status} ${res.statusText}`);

      const data = await res.json();
      await handleAuditResults(data, url, siteType);

      resultsSection.classList.remove('hidden');
      activateTab('grades');
    } catch (err) {
      showError(err.message || 'Audit failed unexpectedly.');
    } finally {
      loadingSection.classList.add('hidden');
    }
  });
});
