const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let ready = null;

async function init() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS user_cache (
        auth_key TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }
  await ready;
}

async function load(authKey) {
  await init();
  const res = await pool.query('SELECT data FROM user_cache WHERE auth_key = $1', [authKey]);
  if (res.rows.length === 0) return null;
  return res.rows[0].data;
}

async function save(authKey, data) {
  await init();
  await pool.query(
    `INSERT INTO user_cache (auth_key, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (auth_key) DO UPDATE SET data = $2, updated_at = now()`,
    [authKey, data]
  );
}

module.exports = { load, save };
