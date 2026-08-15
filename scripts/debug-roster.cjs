const { Client } = require('pg');
const SEASON_ID = 'c01885b7-21ea-4adb-bac2-e14820a0001f';

async function main() {
  const client = new Client({
    host: 'localhost', port: 5432, user: 'postgres', password: 'Vfksqktv47', database: 'storyhop',
  });
  await client.connect();
  const r = await client.query(
    `SELECT "characterId", "displayName", "internalName", "safeDisplayName", aliases, role FROM season_characters WHERE "seasonId" = $1 ORDER BY "createdAt"`,
    [SEASON_ID],
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await client.end();
}
main();
