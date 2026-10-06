const crypto = require("node:crypto");
const net = require("node:net");

const SESSION_COOKIE = "tbm_admin_session";
const SESSION_SECONDS = 30 * 60;
const LOCKOUT_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 3;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sessionSecret() {
  const secret = requiredEnv("SESSION_SECRET");
  if (Buffer.byteLength(secret) < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

function redisUrl() {
  const url = requiredEnv("UPSTASH_REDIS_REST_URL").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(url)) {
    throw new Error("UPSTASH_REDIS_REST_URL must use HTTPS.");
  }
  return url;
}

async function redisCommand(command) {
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("UPSTASH_REDIS_REST_TOKEN")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Rate-limit store returned HTTP ${response.status}.`);
  }
  const result = await response.json();
  if (result.error) {
    throw new Error(`Rate-limit store command failed: ${result.error}`);
  }
  return result.result;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const candidate = typeof forwarded === "string"
    ? forwarded.split(",").pop().trim()
    : req.headers["x-real-ip"];
  return typeof candidate === "string" && net.isIP(candidate) ? candidate : "unknown";
}

function rateLimitKey(req) {
  const ipHash = crypto.createHash("sha256").update(clientIp(req)).digest("hex");
  return `tbm-admin-login:${ipHash}`;
}

async function getLockout(req) {
  const result = await redisCommand([
    "EVAL",
    "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); local ttl=redis.call('TTL',KEYS[1]); if n >= tonumber(ARGV[1]) then return {1,math.max(ttl,0)} end; return {0,0}",
    "1",
    rateLimitKey(req),
    String(MAX_LOGIN_ATTEMPTS)
  ]);
  return { blocked: Number(result[0]) === 1, retryAfter: Number(result[1]) || 0 };
}

async function recordFailedLogin(req) {
  return redisCommand([
    "EVAL",
    "local n=redis.call('INCR',KEYS[1]); if n >= tonumber(ARGV[1]) then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[2])) elseif n == 1 then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[2])) end; return n",
    "1",
    rateLimitKey(req),
    String(MAX_LOGIN_ATTEMPTS),
    String(LOCKOUT_SECONDS)
  ]);
}

async function clearFailedLogins(req) {
  const result = await redisCommand([
    "EVAL",
    "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); local ttl=redis.call('TTL',KEYS[1]); if n >= tonumber(ARGV[1]) then return {1,math.max(ttl,0)} end; redis.call('DEL',KEYS[1]); return {0,0}",
    "1",
    rateLimitKey(req),
    String(MAX_LOGIN_ATTEMPTS)
  ]);
  return { blocked: Number(result[0]) === 1, retryAfter: Number(result[1]) || 0 };
}

function loginCodeKeys(req, email) {
  const challengeId = crypto.createHash("sha256")
    .update(`${clientIp(req)}\0${email}`)
    .digest("hex");
  return {
    challenge: `tbm-admin-code:${challengeId}`,
    cooldown: `tbm-admin-code-cooldown:${challengeId}`
  };
}

async function storeLoginCode(req, email, codeHash) {
  const keys = loginCodeKeys(req, email);
  return Number(await redisCommand([
    "EVAL",
    "if redis.call('EXISTS',KEYS[2]) == 1 then return 0 end; redis.call('SET',KEYS[1],ARGV[1],'EX',600); redis.call('SET',KEYS[2],'1','EX',60); return 1",
    "2",
    keys.challenge,
    keys.cooldown,
    codeHash
  ])) === 1;
}

async function verifyLoginCode(req, email, codeHash) {
  const keys = loginCodeKeys(req, email);
  return Number(await redisCommand([
    "EVAL",
    "local saved=redis.call('GET',KEYS[1]); if not saved then return 0 end; if saved == ARGV[1] then redis.call('DEL',KEYS[1]); return 1 end; return 0",
    "1",
    keys.challenge,
    codeHash
  ])) === 1;
}

async function clearLoginCode(req, email) {
  const keys = loginCodeKeys(req, email);
  await redisCommand(["DEL", keys.challenge]);
}

function cookieOptions(req, maxAge) {
  const secure = process.env.VERCEL === "1" || req.headers["x-forwarded-proto"] === "https";
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function setSessionCookie(req, res) {
  const token = createSessionToken();
  const options = cookieOptions(req, SESSION_SECONDS).replace(`${SESSION_COOKIE}=`, `${SESSION_COOKIE}=${token}`);
  res.setHeader("Set-Cookie", options);
}

function clearSessionCookie(req, res) {
  res.setHeader("Set-Cookie", cookieOptions(req, 0));
}

function readSession(req) {
  const cookieHeader = req.headers.cookie || "";
  const token = cookieHeader
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  let expected;
  try {
    expected = crypto.createHmac("sha256", sessionSecret()).update(payload).digest();
  } catch {
    return false;
  }
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    return Number.isInteger(session.issuedAt)
      && Number.isInteger(session.expiresAt)
      && session.expiresAt > now
      && session.expiresAt - session.issuedAt <= SESSION_SECONDS;
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, data) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(statusCode).json(data);
}

function requireSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function requireAdminSession(req, res) {
  if (!readSession(req)) {
    sendJson(res, 401, { error: "সেশনের মেয়াদ শেষ হয়েছে। আবার লগইন করুন।" });
    return false;
  }
  setSessionCookie(req, res);
  return true;
}

module.exports = {
  clearFailedLogins,
  clearLoginCode,
  clearSessionCookie,
  getLockout,
  LOCKOUT_SECONDS,
  MAX_LOGIN_ATTEMPTS,
  readSession,
  recordFailedLogin,
  requireAdminSession,
  requireSameOrigin,
  requiredEnv,
  sendJson,
  storeLoginCode,
  setSessionCookie,
  verifyLoginCode
};
