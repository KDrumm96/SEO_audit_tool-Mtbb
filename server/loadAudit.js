// server/loadAudit.js
const supabase = require("./supabaseClient");

/**
 * Loads audit data by token
 * @param {string} token
 * @returns {Promise<object|null>}
 */
async function loadAuditByToken(token) {
  const { data, error } = await supabase
    .from("audits")
    .select("*")
    .eq("token", token)
    .single();

  if (error) {
    console.warn("Audit not found or error:", error.message);
    return null;
  }

  return data;
}

module.exports = loadAuditByToken;
