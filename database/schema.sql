CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  category VARCHAR(100) NOT NULL,
  division VARCHAR(100) NOT NULL,
  district VARCHAR(100) NOT NULL DEFAULT '',
  upazila VARCHAR(150) NOT NULL DEFAULT '',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  location TEXT NOT NULL DEFAULT '',
  published_time TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS news_created_at_desc_idx
  ON news (created_at DESC);
