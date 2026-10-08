const { getSql, databaseFailure } = require("../lib/db");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function htmlResponse(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    statusCode === 200 ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store"
  );
  return res.end(html);
}

function renderSharePage(news, origin) {
  const id = news.id;
  const articleUrl = `${origin}/news/${encodeURIComponent(id)}`;
  const redirectUrl = `/?id=${encodeURIComponent(id)}`;
  const title = String(news.title || "TBM NEWS BD").trim();
  const description = String(news.desc || "TBM NEWS BD — ন্যায়ের কথা বলি এবং লিখি।")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  let imageUrl = `${origin}/logo.png`;

  if (typeof news.img === "string" && news.img.trim()) {
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(news.img)) {
      imageUrl = `${origin}/api/share-image?id=${encodeURIComponent(id)}`;
    } else {
      try {
        const image = new URL(news.img);
        if (image.protocol === "https:" || image.protocol === "http:") {
          imageUrl = image.href;
        }
      } catch {
        // Keep the public logo as the fallback when an article has no shareable image.
      }
    }
  }

  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImageUrl = escapeHtml(imageUrl);
  const safeArticleUrl = escapeHtml(articleUrl);

  return `<!doctype html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} | TBM NEWS BD</title>
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${safeArticleUrl}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="TBM NEWS BD">
  <meta property="og:url" content="${safeArticleUrl}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="${safeImageUrl}">
  <meta property="og:image:alt" content="${safeTitle}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImageUrl}">
</head>
<body>
  <p>সংবাদটি খোলা হচ্ছে… <a href="${escapeHtml(redirectUrl)}">এখানে চাপ দিন</a>।</p>
  <script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return htmlResponse(res, 405, "এই অনুরোধটি গ্রহণযোগ্য নয়।");
  }

  const id = req.query && req.query.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(id)) {
    return htmlResponse(res, 400, "সংবাদের আইডি সঠিক নয়।");
  }

  try {
    const rows = await getSql()`
      SELECT id, title, description AS "desc", image AS img
      FROM news
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows.length) {
      return htmlResponse(res, 404, "সংবাদটি পাওয়া যায়নি।");
    }

    const host = req.headers && req.headers.host;
    if (typeof host !== "string" || !host) {
      throw new Error("Request host is missing.");
    }
    const origin = new URL(`https://${host}`).origin;
    return htmlResponse(res, 200, renderSharePage(rows[0], origin));
  } catch (error) {
    const failure = databaseFailure(error);
    console.error("News share preview could not be generated.", {
      code: failure.body.code,
      databaseErrorCode: error.code || "UNKNOWN"
    });
    return htmlResponse(res, failure.statusCode, escapeHtml(failure.body.error));
  }
};
