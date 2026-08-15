/* Runs every SQL migration in an isolated PostgreSQL schema and rolls it back. */
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;
const connection = connectionString
  ? { connectionString, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false }
  : {
      host: process.env.DB_HOST || process.env.DATABASE_HOST,
      port: Number(process.env.DB_PORT || process.env.DATABASE_PORT || 5432),
      user: process.env.DB_USERNAME || process.env.DATABASE_USER,
      password: process.env.DB_PASSWORD || process.env.DATABASE_PASSWORD,
      database: process.env.DB_NAME || process.env.DATABASE_NAME || 'postgres',
    };

const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
const schema = `storyhop_migration_smoke_${Date.now()}`;

(async () => {
  const client = new Client(connection);
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}, public`);
    for (const file of files) {
      await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [schema],
    );
    console.log(JSON.stringify({ ok: true, migrations: files.length, tables: tables.rows.length }));
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || null, message: error.message }));
  process.exit(1);
});
