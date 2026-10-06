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
    `;
    return sendJson(res, 200, { news: rows });
  } catch (error) {
    console.error("Public news request failed.", error);
    return sendJson(res, 500, { error: "সংবাদ লোড করা যায়নি। ডাটাবেস সংযোগ পরীক্ষা করুন।" });
  }
};
