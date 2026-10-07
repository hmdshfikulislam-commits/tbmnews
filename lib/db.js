const { neon } = require("@neondatabase/serverless");

let database;

function getSql() {
  if (!database) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Missing required environment variable: DATABASE_URL");
    }
    database = neon(connectionString);
  }
  return database;
}

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

module.exports = { getSql, databaseFailure };
