const crypto = require("node:crypto");
const {
  clearFailedLogins,
  clearLoginCode,
  getLockout,
  LOCKOUT_SECONDS,
  recordFailedLogin,
  requireSameOrigin,
  requiredEnv,
  sendJson,
  setSessionCookie,
  storeLoginCode,
  verifyLoginCode
} = require("../../lib/admin");

const ADMIN_EMAIL = "hmdshfikulislam@gmail.com";

function readBody(req) {
  try {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return null;
  }
}

function passwordMatches(candidate) {
  const configured = requiredEnv("ADMIN_PASSWORD");
  if (candidate.length > 256) return false;
  const candidateHash = crypto.createHash("sha256").update(candidate).digest();
  const configuredHash = crypto.createHash("sha256").update(configured).digest();
  return crypto.timingSafeEqual(candidateHash, configuredHash);
}

function verificationCodeHash(code) {
  return crypto.createHmac("sha256", requiredEnv("SESSION_SECRET"))
    .update(`tbm-admin-email-login\0${ADMIN_EMAIL}\0${code}`)
    .digest("hex");
}

async function sendVerificationEmail(email, code) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: requiredEnv("EMAIL_FROM"),
      to: [email],
      subject: "TBM NEWS অ্যাডমিন লগইন কোড",
      text: `আপনার অ্যাডমিন লগইন কোড: ${code}\n\nকোডটি ১০ মিনিট পর্যন্ত কার্যকর থাকবে। আপনি লগইন চেষ্টা না করে থাকলে এই ইমেল উপেক্ষা করুন।`,
      html: `<p>আপনার অ্যাডমিন লগইন কোড:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>কোডটি ১০ মিনিট পর্যন্ত কার্যকর থাকবে। আপনি লগইন চেষ্টা না করে থাকলে এই ইমেল উপেক্ষা করুন।</p>`
    }),
    cache: "no-store"
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Verification email provider returned HTTP ${response.status}: ${details}`);
  }
}

async function failLogin(req) {
  const attempts = Number(await recordFailedLogin(req));
  return { attempts };
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
      return sendJson(res, 429, { error: "পরপর ৩ বার ভুল চেষ্টা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।" });
    }

    const body = readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return sendJson(res, 400, { error: "লগইন তথ্য সঠিক নয়।" });
    }
    if (body.email !== ADMIN_EMAIL) {
      const failure = await failLogin(req);
      if (failure?.attempts >= 3) {
        res.setHeader("Retry-After", String(LOCKOUT_SECONDS));
        return sendJson(res, 429, { error: "৩ বার ভুল তথ্য দেওয়া হয়েছে। নিরাপত্তার জন্য ১৫ মিনিট লগইন বন্ধ থাকবে।" });
      }
      return sendJson(res, 401, { error: "ইমেইল বা পাসওয়ার্ড সঠিক নয়।" });
    }

    if (body.action === "send-code") {
      if (typeof body.password !== "string" || !passwordMatches(body.password)) {
        const failure = await failLogin(req);
        if (failure?.attempts >= 3) {
          res.setHeader("Retry-After", String(LOCKOUT_SECONDS));
          return sendJson(res, 429, { error: "৩ বার ভুল তথ্য দেওয়া হয়েছে। নিরাপত্তার জন্য ১৫ মিনিট লগইন বন্ধ থাকবে।" });
        }
        return sendJson(res, 401, { error: "ইমেইল বা পাসওয়ার্ড সঠিক নয়।" });
      }

      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = verificationCodeHash(code);
      const stored = await storeLoginCode(req, ADMIN_EMAIL, codeHash);
      if (!stored) {
        return sendJson(res, 429, { error: "নতুন কোড পাঠাতে ১ মিনিট অপেক্ষা করুন।" });
      }
      try {
        await sendVerificationEmail(ADMIN_EMAIL, code);
      } catch (error) {
        await clearLoginCode(req, ADMIN_EMAIL);
        throw error;
      }
      return sendJson(res, 200, { codeSent: true });
    }

    if (body.action === "verify-code") {
      const code = typeof body.code === "string" ? body.code : "";
      const validCode = /^\d{6}$/.test(code)
        && await verifyLoginCode(req, ADMIN_EMAIL, verificationCodeHash(code));
      if (!validCode) {
        const failure = await failLogin(req);
        if (failure?.attempts >= 3) {
          res.setHeader("Retry-After", String(LOCKOUT_SECONDS));
          return sendJson(res, 429, { error: "৩ বার ভুল কোড দেওয়া হয়েছে। ১৫ মিনিট লগইন বন্ধ থাকবে।" });
        }
        return sendJson(res, 401, { error: "ইমেইলে পাওয়া কোডটি সঠিক নয় বা মেয়াদ শেষ হয়েছে।" });
      }

      const loginResult = await clearFailedLogins(req);
      if (loginResult.blocked) {
        res.setHeader("Retry-After", String(loginResult.retryAfter));
        return sendJson(res, 429, { error: "পরপর ৩ বার ভুল চেষ্টা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।" });
      }
      setSessionCookie(req, res);
      return sendJson(res, 200, { authenticated: true });
    }

    return sendJson(res, 400, { error: "লগইন ধাপ সঠিক নয়।" });
  } catch (error) {
    console.error("Admin login failed.", error);
    return sendJson(res, 503, { error: "লগইন সেবা এখন পাওয়া যাচ্ছে না। Vercel সেটিং পরীক্ষা করুন।" });
  }
};
