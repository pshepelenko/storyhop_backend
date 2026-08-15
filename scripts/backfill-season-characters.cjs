const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

const COMPANION_SAFE = {
  'toothless junior': {
    safeName: 'Midnight Junior',
    visual: 'one small friendly black dragon cub with large soft green eyes and gentle posture',
  },
};

const KNOWN_ALLIES = {
  ivar: { role: 'child_ally', type: 'human child', visual: 'blond boy in a blue fur-trimmed cloak' },
  shimmer: { role: 'magical_helper', type: 'tiny glowing green fairy-like sprite', visual: 'tiny glowing green fairy-like sprite with translucent wings' },
};

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'Vfksqktv47',
    database: process.env.DATABASE_NAME || 'storyhop',
  });
  await client.connect();

  const seasons = await client.query(`
    SELECT s."seasonId", h."heroProfile", h."heroVisualBrief", h."heroReferenceImageUrl", sf."seasonBible"
    FROM seasons s
    JOIN heroes h ON h."seasonId" = s."seasonId"
    LEFT JOIN season_frameworks sf ON sf."seasonId" = s."seasonId"
  `);

  for (const row of seasons.rows) {
    const existing = await client.query(
      `SELECT COUNT(*)::int AS count FROM season_characters WHERE "seasonId" = $1`,
      [row.seasonId],
    );
    if (existing.rows[0].count > 0) {
      console.log(`Skip ${row.seasonId}: roster already exists`);
      continue;
    }

    const now = new Date().toISOString();
    const heroProfile = row.heroProfile || {};
    const visualBrief = row.heroVisualBrief || {};
    const seasonBible = row.seasonBible || {};
    const rawHeroName = String(heroProfile.name || heroProfile.preferredName || 'Hero');
    const heroDisplay = rawHeroName.split(/\s+/)[0];
    const records = [];

    records.push({
      characterId: uuidv4(),
      seasonId: row.seasonId,
      displayName: heroDisplay,
      internalName: rawHeroName,
      safeDisplayName: heroDisplay,
      aliases: JSON.stringify([rawHeroName]),
      role: 'main_hero',
      type: visualBrief.speciesOrType || 'human child',
      visualDescription: [visualBrief.outfit, visualBrief.silhouette].filter(Boolean).join(', ') || 'young child hero',
      mainColors: JSON.stringify(visualBrief.mainColors || []),
      referenceImageUrl: /^https?:\/\//i.test(row.heroReferenceImageUrl || '') ? row.heroReferenceImageUrl : null,
      needsReview: true,
      createdAt: now,
      updatedAt: now,
    });

    const companion = heroProfile.companion;
    if (companion?.name) {
      const override = COMPANION_SAFE[String(companion.name).toLowerCase()];
      records.push({
        characterId: uuidv4(),
        seasonId: row.seasonId,
        displayName: override?.safeName || companion.name,
        internalName: companion.name,
        safeDisplayName: override?.safeName || companion.name,
        aliases: JSON.stringify([companion.name]),
        role: 'recurring_companion',
        type: companion.type || 'companion',
        visualDescription: override?.visual || `${companion.name}, a ${companion.type || 'companion'}`,
        needsReview: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const bibleCharacter of seasonBible.mainCharacters || []) {
      const name = String(bibleCharacter?.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const known = KNOWN_ALLIES[key];
      records.push({
        characterId: uuidv4(),
        seasonId: row.seasonId,
        displayName: known ? name.split(/\s+/)[0] : name.split(/\s+/)[0],
        internalName: name,
        safeDisplayName: name.split(/\s+/)[0],
        aliases: JSON.stringify([name]),
        role: known?.role || 'minor_character',
        type: known?.type || 'story character',
        visualDescription: known?.visual || bibleCharacter.personality || name,
        needsReview: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const record of records) {
      await client.query(
        `INSERT INTO season_characters (
          "characterId", "seasonId", "displayName", "internalName", "safeDisplayName", aliases, role, type,
          "visualDescription", "mainColors", "countRule", "referenceImageUrl", "needsReview", "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,'exactly_one_when_selected',$11,$12,$13,$14)`,
        [
          record.characterId,
          record.seasonId,
          record.displayName,
          record.internalName,
          record.safeDisplayName,
          record.aliases,
          record.role,
          record.type,
          record.visualDescription,
          record.mainColors || '[]',
          record.referenceImageUrl || null,
          record.needsReview,
          record.createdAt,
          record.updatedAt,
        ],
      );
    }

    console.log(`Backfilled ${records.length} characters for season ${row.seasonId}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
