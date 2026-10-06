const { getSql } = require("../../lib/db");
const {
  requireAdminSession,
  requireSameOrigin,
  sendJson
} = require("../../lib/admin");

class ValidationError extends Error {}

function readBody(req) {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("বিজ্ঞাপনের তথ্য সঠিক নয়।");
  }
  return body;
}

function textField(value, name, maxLength, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") throw new ValidationError(`${name} সঠিক নয়।`);
  const text = value.trim();
  if (required && !text) throw new ValidationError(`${name} যোগ করুন।`);
  if (text.length > maxLength) throw new ValidationError(`${name} ${maxLength} অক্ষরের মধ্যে রাখুন।`);
  return text;
}

function advertisementFields(body) {
  const title = textField(body.title, "বিজ্ঞাপনের শিরোনাম", 180);
  const image = textField(body.image, "বিজ্ঞাপনের ছবি", 720000, true);
  const targetUrl = textField(body.targetUrl, "বিজ্ঞাপনের লিংক", 2048);
  const isDataImage = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(image);
  if (!isDataImage && !/^https?:\/\/\S+$/i.test(image)) {
    throw new ValidationError("বিজ্ঞাপনের ছবিতে HTTP/HTTPS লিংক অথবা PNG/JPEG/WebP/GIF ছবি দিন।");
  }
  if (image.startsWith("data:image/") && (!isDataImage || image.length > 720000)) {
    throw new ValidationError("ছবিটি PNG/JPEG/WebP/GIF হতে হবে এবং ৫০০ KB-এর মধ্যে রাখুন।");
  }
  if (targetUrl) {
    try {
      if (!["http:", "https:"].includes(new URL(targetUrl).protocol)) throw new Error();
    } catch {
      throw new ValidationError("বিজ্ঞাপনের লিংকটি HTTP/HTTPS ঠিকানা হতে হবে।");
    }
  }
  return { title, image, targetUrl };
}

module.exports = async function handler(req, res) {
  if (!["GET", "PUT", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT, DELETE");
    return sendJson(res, 405, { error: "এই অনুরোধটি গ্রহণযোগ্য নয়।" });
  }
  if (req.method !== "GET" && !requireSameOrigin(req)) {
    return sendJson(res, 403, { error: "এই অনুরোধটি গ্রহণযোগ্য নয়।" });
  }
  if (!requireAdminSession(req, res)) return;

  try {
    const sql = getSql();
    if (req.method === "GET") {
      const rows = await sql`
        SELECT title, image, target_url AS "targetUrl"
        FROM advertisements
        WHERE id = 'homepage'
        LIMIT 1
      `;
      return sendJson(res, 200, { ad: rows[0] || null });
    }
    if (req.method === "DELETE") {
      await sql`DELETE FROM advertisements WHERE id = 'homepage'`;
      return sendJson(res, 200, { deleted: true });
    }

    const fields = advertisementFields(readBody(req));
    const rows = await sql`
      INSERT INTO advertisements (id, title, image, target_url, updated_at)
      VALUES ('homepage', ${fields.title}, ${fields.image}, ${fields.targetUrl}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        image = EXCLUDED.image,
        target_url = EXCLUDED.target_url,
        updated_at = NOW()
      RETURNING title, image, target_url AS "targetUrl"
    `;
    return sendJson(res, 200, { ad: rows[0] });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ValidationError) {
      return sendJson(res, 400, { error: error.message || "বিজ্ঞাপনের তথ্য সঠিক নয়।" });
    }
    console.error("Admin advertisement request failed.", {
      databaseErrorCode: error.code || "UNKNOWN"
    });
    return sendJson(res, 503, { error: "বিজ্ঞাপন সংরক্ষণ করা যায়নি। ডাটাবেস ও schema যাচাই করুন।" });
  }
};
