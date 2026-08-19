const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
  : null;

if (pool) {
  pool.on('error', (err) => console.error('Erro inesperado no pool do Postgres:', err.message));
}

let ready = null;
async function init() {
  if (!pool) return;
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS known_users (
        auth_key TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }
  await ready;
}

// Chama isso no login - so registra que essa pessoa existe, nada pesado
async function remember(authKey) {
  if (!pool) return;
  try {
    await init();
    await pool.query(
      `INSERT INTO known_users (auth_key) VALUES ($1) ON CONFLICT DO NOTHING`,
      [authKey]
    );
  } catch (err) {
    console.error('Falha ao registrar usuario no banco:', err.message);
  }
}

// Chama isso quando o servidor liga - traz de volta todo mundo que ja instalou
async function listAll() {
  if (!pool) return [];
  try {
    await init();
    const res = await pool.query('SELECT auth_key FROM known_users');
    return res.rows.map(r => r.auth_key);
  } catch (err) {
    console.error('Falha ao listar usuarios do banco:', err.message);
    return [];
  }
}

module.exports = { remember, listAll };
