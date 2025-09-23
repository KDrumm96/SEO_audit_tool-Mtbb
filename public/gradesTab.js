// gradesTab.js — render cards; top fixes ranked by IMPACT (weight-aware)

export function renderGradeCards(scoreData = {}) {
  const container = document.getElementById('scoreCards');
  if (!container) return;
  container.innerHTML = '';

  const preferredOrder = ['seo', 'performance', 'accessibility', 'content', 'ux'];
  const labels = {
    seo: 'SEO',
    performance: 'Performance',
    accessibility: 'Accessibility',
    content: 'Content',
    ux: 'User Experience'
  };
  const descriptions = {
    seo: 'Search visibility, crawling, metadata, structured data.',
    performance: 'Page speed, Core Web Vitals, resource optimization.',
    accessibility: 'Inclusive UX: semantics, contrast, keyboard usage.',
    content: 'Clarity, hierarchy, on-page relevance.',
    ux: 'Navigation, mobile ergonomics, consistency.'
  };
  const icons = { S: '🏆', A: '✅', B: '👍', C: '⚠️', D: '❗', F: '⛔' };

  // Shared thresholds (must match backend)
  const thresholds = [
    { grade: 'S', min: 0.95 },
    { grade: 'A', min: 0.85 },
    { grade: 'B', min: 0.75 },
    { grade: 'C', min: 0.60 },
    { grade: 'D', min: 0.40 },
    { grade: 'F', min: 0.00 }
  ];
  const gradeFromScore = (v) => {
    if (typeof v !== 'number' || !isFinite(v)) return 'F';
    for (const t of thresholds) if (v >= t.min) return t.grade;
    return 'F';
  };
  const pct = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 100) : null);
  const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

  const allKeys = Object.keys(scoreData || {});
  const extraKeys = allKeys.filter(k => !preferredOrder.includes(k)).sort();
  const ordered = preferredOrder.filter(k => allKeys.includes(k)).concat(extraKeys);

  for (const section of ordered) {
    const data = scoreData[section] || {};
    const score = typeof data.weightedScore === 'number' ? data.weightedScore : null;
    if (score == null) continue;

    const serverGrade = (data.grade || '').toString().toUpperCase();
    const grade = serverGrade || gradeFromScore(score);
    const pctVal = pct(score);

    const title = labels[section] || pretty(section);
    const desc = data.tip || descriptions[section] || 'Audit category summary.';
    const icon = icons[grade] || '';

    // Card shell
    const card = document.createElement('div');
    card.className = 'grade-card';

    const header = document.createElement('div');
    header.className = 'grade-header';
    header.innerHTML = `
      <span>${title}</span>
      <span class="grade-badge">${icon} ${grade}</span>
    `;

    const scoreLine = document.createElement('div');
    scoreLine.className = 'grade-score';
    scoreLine.textContent = `Score: ${pctVal}%`;

    const tip = document.createElement('div');
    tip.className = 'grade-tip';
    tip.textContent = `💡 ${desc}`;

    card.appendChild(header);
    card.appendChild(scoreLine);
    card.appendChild(tip);

    // Top fixes (weight-aware): impact = (1 - score) * weight
    if (Array.isArray(data.signals) && data.signals.length) {
      const fixes = data.signals
        .filter(s => typeof s.score === 'number')
        .map(s => {
          const w = (typeof s.weight === 'number' ? s.weight : 1);
          const impact = (1 - Math.max(0, Math.min(1, s.score))) * w;
          return { ...s, impact };
        })
        .filter(s => s.impact > 0.06)         // hide low-impact noise (tweak if desired)
        .sort((a, b) => b.impact - a.impact)  // highest impact first
        .slice(0, 3);

      if (fixes.length) {
        const subHead = document.createElement('div');
        subHead.className = 'grade-subhead';
        subHead.textContent = 'Top fixes:';

        const listWrap = document.createElement('div');
        listWrap.className = 'grade-sublist';
        const ul = document.createElement('ul');

        fixes.forEach(s => {
          const li = document.createElement('li');
          const pctSig = Math.round((s.score || 0) * 100);
          const label = s.label || pretty(s.id || 'Signal');
          const hint = s.description || s.tip ? ` — ${s.description || s.tip}` : '';
          li.textContent = `${label}: ${pctSig}%${hint}`;
          ul.appendChild(li);
        });

        listWrap.appendChild(subHead);
        listWrap.appendChild(ul);
        card.appendChild(listWrap);
      }
    }

    container.appendChild(card);
  }
}
