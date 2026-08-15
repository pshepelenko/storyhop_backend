const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const sqlPath = path.join(__dirname, '../src/migrations/003-season-characters.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'Vfksqktv47',
    database: process.env.DATABASE_NAME || 'storyhop',
  });
  await client.connect();
  await client.query(sql);
  await client.query(
    `INSERT INTO migrations (name, "executedAt")
     VALUES ('003-season-characters.sql', NOW())
     ON CONFLICT (name) DO NOTHING`,
  );
  console.log('Migration 003 applied');
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
