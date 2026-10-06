const { getSql } = require("../lib/db");
const { sendJson } = require("../lib/admin");

function databaseFailure(error) {
  if (error.message === "Missing required environment variable: DATABASE_URL") {
    return {
      statusCode: 503,
      body: {
        error: "Vercel Production environment-এ DATABASE_URL সেট করা নেই।",
        code: "DATABASE_URL_MISSING"
      }
    };
  }
  if (error.code === "42P01" || error.code === "42703") {
    return {
      statusCode: 503,
      body: {
        error: "Neon ডাটাবেসে news টেবিল বা প্রয়োজনীয় কলাম নেই। database/schema.sql চালান।",
        code: "NEWS_SCHEMA_MISSING"
      }
    };
  }
  if (error.code === "28P01" || error.code === "3D000") {
    return {
      statusCode: 503,
      body: {
        error: "DATABASE_URL-এর ডাটাবেস বা লগইন তথ্য সঠিক নয়। Neon-এর connection string যাচাই করুন।",
        code: "DATABASE_URL_INVALID"
      }
    };
  }
  return {
    statusCode: 503,
    body: {
      error: "Neon ডাটাবেসে সংযোগ করা যায়নি। DATABASE_URL ও Neon project-এর অবস্থা যাচাই করুন।",
      code: "DATABASE_UNAVAILABLE"
    }
  };
}

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
    const failure = databaseFailure(error);
    console.error("Public news request failed.", {
      code: failure.body.code,
      databaseErrorCode: error.code || "UNKNOWN"
    });
    return sendJson(res, failure.statusCode, failure.body);
  }
};
