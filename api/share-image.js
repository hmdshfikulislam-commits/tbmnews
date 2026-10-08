const { getSql, databaseFailure } = require("../lib/db");

function textResponse(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(message);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return textResponse(res, 405, "এই অনুরোধটি গ্রহণযোগ্য নয়।");
  }

  const id = req.query && req.query.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(id)) {
    return textResponse(res, 400, "সংবাদের আইডি সঠিক নয়।");
  }

  try {
    const rows = await getSql()`
      SELECT image
      FROM news
      WHERE id = ${id}
      LIMIT 1
    `;
    const image = rows[0] && rows[0].image;
    const match = typeof image === "string" && image.length <= 720000
      ? /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image)
      : null;
    if (!match) {
      return textResponse(res, 404, "সংবাদের ছবি পাওয়া যায়নি।");
    }

    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== match[2].replace(/=+$/, "")) {
      return textResponse(res, 404, "সংবাদের ছবি সঠিক নয়।");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", `image/${match[1].toLowerCase()}`);
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(bytes);
  } catch (error) {
    const failure = databaseFailure(error);
    console.error("News share image could not be loaded.", {
      code: failure.body.code,
      databaseErrorCode: error.code || "UNKNOWN"
    });
    return textResponse(res, failure.statusCode, failure.body.error);
  }
};
