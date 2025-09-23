// /api/run-audit.js
// Paywalled audit runner. Checks the "pro" cookie if PAYWALL_ENABLED=1.
// Calls your existing server/runAudit.js (unchanged).

const cookie = require('cookie');

function getCookie(req, name) {
  const parsed = cookie.parse(req.headers.cookie || '');
  return parsed[name];
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Paywall
    const paywallOn = process.env.PAYWALL_ENABLED === '1';
    const hasPro = getCookie(req, 'pro') === '1';

    if (paywallOn && !hasPro) {
      return res.status(402).json({
        error: 'PAYWALL',
        message: 'Upgrade required to run the full audit.'
      });
    }

    // Pull inputs
    const { url, siteType = 'base' } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Invalid or missing URL' });
    }

    // Run your existing audit pipeline
    const runAudit = require('../server/runAudit');
    const result = await runAudit(url, siteType);

    return res.status(200).json(result);
  } catch (err) {
    console.error('run-audit error:', err);
    return res.status(500).json({ error: 'Audit failed' });
  }
};
