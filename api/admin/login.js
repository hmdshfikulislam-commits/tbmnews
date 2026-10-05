const crypto = require("node:crypto");
const {
  clearFailedLogins,
  getLockout,
  LOCKOUT_SECONDS,
  recordFailedLogin,
  requireSameOrigin,
  requiredEnv,
  sendJson,
  setSessionCookie
} = require("../../lib/admin");

const ADMIN_EMAIL = "hmdshfikulislam@gmail.com";

// --- 2FA Helper ---
function base32Decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", out = [];
  str = str.toUpperCase().replace(/=+$/, "");
  for (let c of str) {
    let v = alphabet.indexOf(c);
    if (v === -1) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.substring(i, i + 8), 2));
  return Buffer.from(out);
}

function verifyTOTP(token, secret) {
  try {
    const key = base32Decode(secret);
    const time = Math.floor(Date.now() / 1000 / 30);
    for (let i = -1; i <= 1; i++) { // 30 sec আগে/পরে accept করবে
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(time + i));
      const hmac = crypto.createHmac("sha1", key).update(counter).digest();
      const offset = hmac[hmac.length - 1] & 0x0f;
      const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
      if (code.toString().padStart(6, "0") === token) return true;
    }
    return false;
  } catch { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "এই অনুরোধটি গ্রহণযোগ্য নয়।" });
  }
  if (!requireSameOrigin(req)) {
    return sendJson(res, 403, { error: "এই অনুরোধটি গ্রহণযোগ্য নয়।" });
  }

  try {
    const lockout = await getLockout(req);
    if (lockout.blocked) {
      res.setHeader("Retry-After", String(lockout.retryAfter));
      return sendJson(res, 429, { error: "পরপর ৩ বার ভুল কোড দেওয়া হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।" });
    }

    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return sendJson(res, 400, { error: "লগইন তথ্য সঠিক নয়।" });
    }
    
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const totpCode = typeof body?.totp === "string" ? body.totp : "";
    const totpSecret = requiredEnv("TOTP_SECRET");

    if (email !== ADMIN_EMAIL) {
      const attempts = Number(await recordFailedLogin(req));
      if (attempts >= 3) {
        res.setHeader("Retry-After", String(LOCKOUT_SECONDS));
        return sendJson(res, 429, { error: "৩ বার ভুল তথ্য দেওয়া হয়েছে। নিরাপত্তার জন্য ১৫ মিনিট লগইন বন্ধ থাকবে।" });
      }
      return sendJson(res, 401, { error: `অনুমোদিত ইমেইল নয়। আরও ${3 - attempts} বার চেষ্টা করা যাবে।` });
    }

    if (!/^\d{6}$/.test(totpCode) || !verifyTOTP(totpCode, totpSecret)) {
      const attempts = Number(await recordFailedLogin(req));
      if (attempts >= 3) {
        res.setHeader("Retry-After", String(LOCKOUT_SECONDS));
        return sendJson(res, 429, { error: "৩ বার ভুল 2FA কোড। ১৫ মিনিট ব্লক।" });
      }
      return sendJson(res, 401, { error: `ভুল 2FA কোড। আরও ${3 - attempts} বার চেষ্টা করা যাবে।` });
    }

    const loginResult = await clearFailedLogins(req);
    if (loginResult.blocked) {
      res.setHeader("Retry-After", String(loginResult.retryAfter));
      return sendJson(res, 429, { error: "পরপর ৩ বার ভুল কোড দেওয়া হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।" });
    }
    setSessionCookie(req, res);
    return sendJson(res, 200, { authenticated: true });
  } catch (error) {
    console.error("Admin login failed.", error);
    return sendJson(res, 503, { error: "লগইন সেবা এখন পাওয়া যাচ্ছে না। Vercel সেটিং পরীক্ষা করুন।" });
  }
};