// saveAudit.js
// Saves completed audit results to Supabase (if enabled) and generates a token.

const supabaseClient = require('./supabaseClient');
const crypto = require('crypto');

/**
 * Generates a short alphanumeric audit token.
 * Example: "MTBB-1A2F"
 * @returns {string}
 */
function generateToken() {
  const id = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `MTBB-${id}`;
}

/**
 * Saves the audit to the 'audits' table in Supabase.
 * @param {Object} param0
 * @param {string} param0.url - The audited URL.
 * @param {string} param0.keyword - The target keyword (if any).
 * @param {string} param0.tier - Access tier of the audit (e.g. 'basic').
 * @param {Object} param0.scores - The scored audit results (with grades).
 * @param {string} param0.insights - The AI-generated improvement plan or summary.
 * @returns {Promise<string>} - The generated audit token.
 */
async function saveAudit({ url, keyword = "", tier = "basic", scores, insights }) {
  const token = generateToken();
  const { error } = await supabaseClient
    .from("audits")
    .insert([{
      token,
      url,
      keyword,
      tier,
      scores,
      insights
    }]);
  if (error) {
    console.error("Failed to save audit to Supabase:", error.message);
    throw new Error("Could not save audit data.");
  }
  return token;
}

module.exports = saveAudit;
