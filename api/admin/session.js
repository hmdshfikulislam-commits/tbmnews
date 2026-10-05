const {
  clearSessionCookie,
  readSession,
  requireAdminSession,
  requireSameOrigin,
  sendJson
} = require("../../lib/admin");

module.exports = function handler(req, res) {
  if (req.method === "GET") {
    if (!readSession(req)) {
      return sendJson(res, 401, { authenticated: false });
    }
    requireAdminSession(req, res);
    return sendJson(res, 200, { authenticated: true });
  }
  if (req.method === "POST") {
    if (!requireSameOrigin(req)) {
      return sendJson(res, 403, { error: "এই অনুরোধটি গ্রহণযোগ্য নয়।" });
    }
    clearSessionCookie(req, res);
    return sendJson(res, 200, { authenticated: false });
  }
  res.setHeader("Allow", "GET, POST");
  return sendJson(res, 405, { error: "এই অনুরোধটি গ্রহণযোগ্য নয়।" });
};
