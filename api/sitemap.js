const { getSql, databaseFailure } = require("../lib/db");

const SITE_URL = "https://tbmnewsbd.com";
const FIRESTORE_PROJECT_ID = "tbmnews-fdd03";
const FIREBASE_API_KEY = "AIzaSyB_Jr66GoSsKTPVq8bdnYSMsh6W2WPTOfTk";
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
    || DEMO_TEXT.test(String(article.title || ""))
    || DEMO_TEXT.test(String(article.description || ""));
}

function firestoreField(fields, name) {
  const field = fields && fields[name];
  if (!field) return undefined;
  return field.stringValue ?? field.booleanValue ?? field.timestampValue;
}

function firestoreArticle(document) {
  const name = document.name;
  if (typeof name !== "string") {
    throw new Error("Firestore returned a document without a name.");
  }
  const id = decodeURIComponent(name.slice(name.lastIndexOf("/") + 1));
  const fields = document.fields || {};
  const dateValue = ["updatedAt", "createdAt", "timestamp"]
    .map(field => firestoreField(fields, field))
    .find(Boolean);

  return {
    id,
    title: firestoreField(fields, "title"),
    description: firestoreField(fields, "desc") ?? firestoreField(fields, "description"),
    isDemo: firestoreField(fields, "isDemo") === true
      || firestoreField(fields, "is_demo") === true,
    lastmod: isoDate(dateValue)
  };
}

async function getFirestoreArticles() {
  const articles = [];
  const seenTokens = new Set();
  let pageToken;

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/news`
    );
    url.searchParams.set("key", FIREBASE_API_KEY);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      throw new Error(`Firestore returned HTTP ${response.status}.`);
    }

    const result = await response.json();
    if (result.documents !== undefined && !Array.isArray(result.documents)) {
      throw new Error("Firestore returned an invalid documents list.");
    }
    for (const document of result.documents || []) {
      articles.push(firestoreArticle(document));
    }

    pageToken = result.nextPageToken || undefined;
    if (pageToken) {
      if (seenTokens.has(pageToken)) {
        throw new Error("Firestore pagination returned a repeated page token.");
      }
      seenTokens.add(pageToken);
    }
  } while (pageToken);

  return articles;
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
      getFirestoreArticles()
    ]);

    const articlesById = new Map();
    for (const article of [...firestoreArticles, ...neonArticles]) {
      if (!article.id || isDemoArticle(article)) continue;
      articlesById.set(String(article.id), {
        id: String(article.id),
        lastmod: isoDate(article.createdAt) || article.lastmod
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
        loc: `${SITE_URL}/`,
        lastmod: latestArticleDate,
        changefreq: "daily",
        priority: "1.0"
      }),
      ...articles.map(article => renderEntry({
        loc: `${SITE_URL}/news/${encodeURIComponent(article.id)}`,
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
