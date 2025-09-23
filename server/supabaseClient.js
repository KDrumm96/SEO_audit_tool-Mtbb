const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Check if a token is expired based on created_at or revoked flag
function isExpired(createdAt, revoked = false, days = 30) {
  if (revoked) return true;
  const createdDate = new Date(createdAt);
  const now = new Date();
  const diff = (now - createdDate) / (1000 * 60 * 60 * 24);
  return diff > days;
}

// Lookup a token and return its tier or 'expired'
async function getTierByToken(token) {
  const { data, error } = await supabase
    .from("access_tokens")
    .select("tier, created_at, revoked")
    .eq("token", token)
    .single();

  if (error || !data) {
    console.error("❌ Token lookup failed:", error?.message || "No data");
    return null;
  }

  if (isExpired(data.created_at, data.revoked)) {
    console.warn("⚠️ Token expired or revoked");
    return "expired";
  }

  return data.tier;
}

// Check user by email for existing access
async function getTokenByEmail(email) {
  const { data, error } = await supabase
    .from("access_tokens")
    .select("token, tier, created_at, revoked")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    console.error("❌ Email lookup failed:", error?.message || "No data");
    return null;
  }

  if (isExpired(data.created_at, data.revoked)) {
    return { token: null, tier: "expired" };
  }

  return { token: data.token, tier: data.tier };
}

// Store new token in Supabase and optionally mark basic_leads as upgraded
async function storeAuditToken(token, tier = "basic", email = "") {
  const { error } = await supabase
    .from("access_tokens")
    .insert([{ token, tier, email, created_at: new Date().toISOString(), revoked: false }]);

  if (error) {
    console.error("❌ Failed to store token:", error.message);
    return false;
  }

  if (tier !== "basic") {
    await supabase
      .from("basic_leads")
      .update({ upgraded: true, tier })
      .eq("email", email);
  }

  return true;
}

// Track basic users for later marketing with upsert
async function storeBasicLead(email) {
  const { error } = await supabase
    .from("basic_leads")
    .upsert([{ email }], { onConflict: ["email"] });

  if (error) console.error("Failed to store lead:", error.message);
  return true;
}

module.exports = {
  getTierByToken,
  getTokenByEmail,
  storeAuditToken,
  storeBasicLead,
};
