const {
  requireAdminSession,
  requireSameOrigin,
  sendJson
} = require("../../lib/admin");
const { getSql } = require("../../lib/db");
const crypto = require("node:crypto");

class ValidationError extends Error {}

function readBody(req) {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("সংবাদের তথ্য সঠিক নয়।");
  }
  return body;
}

function textField(value, name, maxLength, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") {
    if (required) throw new ValidationError(`${name} পূরণ করুন।`);
    throw new ValidationError(`${name} সঠিক নয়।`);
  }
  const text = value.trim();
  if (required && !text) throw new ValidationError(`${name} পূরণ করুন।`);
  if (text.length > maxLength) throw new ValidationError(`${name} ${maxLength} অক্ষরের মধ্যে রাখুন।`);
  return text;
}

function newsFields(body) {
  if (body.isDemo !== undefined && typeof body.isDemo !== "boolean") {
    throw new ValidationError("ডেমো নিউজের তথ্য সঠিক নয়।");
  }
  const title = textField(body.title, "শিরোনাম", 500, true);
  const description = textField(body.desc, "বিস্তারিত", 18000, true);
  const category = textField(body.cat, "বিভাগ", 100, true);
  const district = textField(body.district, "জেলা", 100);
  const upazila = textField(body.upazila, "থানা / উপজেলা", 150);
  const image = textField(body.img, "ছবির ঠিকানা", 720000);
  if (image && !/^https?:\/\/\S+$/i.test(image)
    && !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(image)) {
    throw new ValidationError("শুধু HTTP/HTTPS ছবির লিংক অথবা PNG/JPEG/WebP/GIF/SVG ছবি ব্যবহার করুন।");
  }
  if (image.startsWith("data:image/") && image.length > 720000) {
    throw new ValidationError("ছবির আকার বেশি। ৫০০ KB-এর মধ্যে ছবি ব্যবহার করুন।");
  }
  return {
    title,
    desc: description,
    img: image,
    cat: category,
    division: category,
    district,
    upazila,
    isDemo: body.isDemo === true,
    location: [category, district, upazila].filter(Boolean).join(" > "),
    time: new Date().toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })
  };
}

function documentId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(value)) {
    throw new ValidationError("সংবাদের আইডি সঠিক নয়।");
  }
  return value;
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
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
        SELECT
          id,
          title,
          description AS "desc",
          image AS img,
          category AS cat,
          division,
          district,
          upazila,
          is_demo AS "isDemo",
          location,
          published_time AS time,
          created_at AS timestamp
        FROM news
        ORDER BY created_at DESC, id DESC
        LIMIT 30
      `;
      return sendJson(res, 200, {
        news: rows
      });
    }

    const body = readBody(req);
    const fields = newsFields(body);
    if (req.method === "POST") {
      const id = crypto.randomUUID();
      await sql`
        INSERT INTO news (
          id, title, description, image, category, division, district, upazila,
          is_demo, location, published_time
        ) VALUES (
          ${id}, ${fields.title}, ${fields.desc}, ${fields.img}, ${fields.cat},
          ${fields.division}, ${fields.district}, ${fields.upazila},
          ${fields.isDemo}, ${fields.location}, ${fields.time}
        )
      `;
      return sendJson(res, 201, { id });
    }
    if (req.method === "PATCH") {
      const id = documentId(body.id);
      const result = await sql`
        UPDATE news SET
          title = ${fields.title},
          description = ${fields.desc},
          image = ${fields.img},
          category = ${fields.cat},
          division = ${fields.division},
          district = ${fields.district},
          upazila = ${fields.upazila},
          is_demo = ${fields.isDemo},
          location = ${fields.location},
          published_time = ${fields.time},
          created_at = NOW()
        WHERE id = ${id}
        RETURNING id
      `;
      if (!result.length) return sendJson(res, 404, { error: "সংবাদটি পাওয়া যায়নি।" });
      return sendJson(res, 200, { id });
    }

    const id = documentId(body.id);
    const result = await sql`DELETE FROM news WHERE id = ${id} RETURNING id`;
    if (!result.length) return sendJson(res, 404, { error: "সংবাদটি পাওয়া যায়নি।" });
    return sendJson(res, 200, { id });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ValidationError) {
      return sendJson(res, 400, { error: error.message || "তথ্য সঠিক নয়।" });
    }
    console.error("Admin news request failed.", error);
    return sendJson(res, 500, { error: "সংবাদের অনুরোধ সম্পন্ন করা যায়নি।" });
  }
};
