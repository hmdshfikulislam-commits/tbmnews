const { getSql, databaseFailure } = require("../lib/db");
const { getFirestoreNews, getSiteUrl } = require("../lib/firestore");
const DEMO_TEXT = /^(?:ডেমো|demo|নমুনা|sample|test)\s*:|\b(?:demo|sample|test)\b|ডেমো|নমুনা/i;

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  })[character]);
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isDemoArticle(article) {
  return article.isDemo === true
    || article.is_demo === true
    || DEMO_TEXT.test(String(article.title || ""))
    || DEMO_TEXT.test(String(article.description || article.desc || ""));
}

function renderEntry({ loc, lastmod, changefreq, priority }) {
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${
    lastmod ? `\n    <lastmod>${xmlEscape(lastmod)}</lastmod>` : ""
  }${
    changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : ""
  }${
    priority ? `\n    <priority>${priority}</priority>` : ""
  }\n  </url>`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 405;
    return res.end("Method not allowed.");
  }

  try {
    const sql = getSql();
    const siteUrl = getSiteUrl();
    const [neonArticles, firestoreArticles] = await Promise.all([
      sql`
        SELECT
          id,
          title,
          description,
          is_demo AS "isDemo",
          created_at AS "createdAt"
        FROM news
        ORDER BY created_at DESC, id DESC
      `,
      getFirestoreNews()
    ]);

    const articlesById = new Map();
    for (const article of [...firestoreArticles, ...neonArticles]) {
      if (!article.id || isDemoArticle(article)) continue;
      const lastmod = article.createdAt
        ? isoDate(article.createdAt)
        : isoDate(article.updatedAt) || isoDate(article.timestamp);
      articlesById.set(String(article.id), {
        id: String(article.id),
        lastmod
      });
    }

    const articles = [...articlesById.values()];
    const latestArticleDate = articles
      .map(article => article.lastmod)
      .filter(Boolean)
      .sort()
      .at(-1);
    const urls = [
      renderEntry({
        loc: `${siteUrl}/`,
        lastmod: latestArticleDate,
        changefreq: "daily",
        priority: "1.0"
      }),
      ...articles.map(article => renderEntry({
        loc: `${siteUrl}/news/${encodeURIComponent(article.id)}`,
        lastmod: article.lastmod,
        changefreq: "hourly",
        priority: "0.8"
      }))
    ];

    res.statusCode = 200;
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.end(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`
    );
  } catch (error) {
    const isDatabaseError = Boolean(error.code)
      || error.message === "Missing required environment variable: DATABASE_URL";
    const failure = isDatabaseError ? databaseFailure(error) : null;
    console.error("Sitemap generation failed.", {
      code: failure ? failure.body.code : "SITEMAP_SOURCE_UNAVAILABLE",
      databaseErrorCode: error.code || "UNKNOWN",
      message: error.message
    });
    res.statusCode = failure ? failure.statusCode : 503;
    res.setHeader("Cache-Control", "no-store");
    return res.end("Sitemap could not be generated.");
  }
};
