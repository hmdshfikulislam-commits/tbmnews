const { getFirestoreNews } = require("../lib/firestore");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed." }));
  }

  try {
    const news = await getFirestoreNews();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=60");
    return res.end(JSON.stringify({ news }));
  } catch (error) {
    console.error("Legacy news request failed.", {
      message: error.message,
      httpStatus: Number.isInteger(error.status) ? error.status : undefined
    });
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({ error: "Legacy news could not be loaded." }));
  }
};
