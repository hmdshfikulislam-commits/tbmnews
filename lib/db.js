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

module.exports = { getSql };
