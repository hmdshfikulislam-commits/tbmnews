const { getSql } = require("../lib/db");
const { sendJson } = require("../lib/admin");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "এই অনুরোধটি গ্রহণযোগ্য নয়।" });
  }

  try {
    const sql = getSql();
    const rows = await sql`
      SELECT title, image, target_url AS "targetUrl"
      FROM advertisements
      WHERE id = 'homepage'
      LIMIT 1
    `;
    return sendJson(res, 200, { ad: rows[0] || null });
  } catch (error) {
    console.error("Homepage advertisement could not be loaded.", {
      databaseErrorCode: error.code || "UNKNOWN"
    });
    return sendJson(res, 503, { error: "বিজ্ঞাপন লোড করা যায়নি।" });
  }
};
