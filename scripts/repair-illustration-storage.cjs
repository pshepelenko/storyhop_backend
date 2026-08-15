const axios = require('axios');
const { Client } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const SEASON_ID = process.argv[2] || 'c01885b7-21ea-4adb-bac2-e14820a0001f';
const EPISODE_NUMBER = Number(process.argv[3] || 32);

function env(...keys) {
  return keys.map((key) => process.env[key]).find(Boolean);
}

function getR2Config() {
  const rawUrl = env('CLOUDFLARE_S3_API');
  const endpoint = env('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT') || (rawUrl ? new URL(rawUrl).origin : undefined);
  const accessKeyId = env('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_SECRET_ACCESS_KEY');
  const bucket = env('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET') || (rawUrl ? rawUrl.split('/').filter(Boolean).pop() : undefined);
  const publicUrl = env('R2_PUBLIC_URL', 'CLOUDFLARE_R2_PUBLIC_URL');
  return { endpoint, accessKeyId, secretAccessKey, bucket, publicUrl, rawUrl };
}

async function uploadToR2(key, body, contentType) {
  const { endpoint, accessKeyId, secretAccessKey, bucket, publicUrl, rawUrl } = getR2Config();
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 storage is not configured');
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, '')}/${key}`;
  }
  if (rawUrl) {
    return `${new URL(rawUrl).origin}/${bucket}/${key}`;
  }
  throw new Error('Cannot build public URL');
}

async function main() {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'Vfksqktv47',
    database: process.env.DATABASE_NAME || 'storyhop',
  });
  await client.connect();

  const epRes = await client.query(
    `SELECT e."episodeId", i."illustrationId", i."imageUrl"
     FROM episodes e
     JOIN illustrations i ON i."episodeId" = e."episodeId"
     WHERE e."seasonId" = $1 AND e."episodeNumber" = $2`,
    [SEASON_ID, EPISODE_NUMBER],
  );
  const row = epRes.rows[0];
  if (!row) {
    console.log('Episode illustration not found');
    await client.end();
    return;
  }

  const storageKey = `images/seasons/${SEASON_ID}/storybook/${row.illustrationId}.png`;
  const sourceUrl = row.imageUrl;
  if (!sourceUrl) {
    console.log('No imageUrl to repair');
    await client.end();
    return;
  }

  if (sourceUrl.includes(`/storybook/${row.illustrationId}.png`)) {
    console.log('Illustration already stored at canonical key:', sourceUrl);
    await client.end();
    return;
  }

  console.log('Downloading from', sourceUrl);
  const response = await axios.get(sourceUrl, { responseType: 'arraybuffer', timeout: 120000 });
  const contentType = String(response.headers?.['content-type'] || 'image/png');
  const storedUrl = await uploadToR2(storageKey, Buffer.from(response.data), contentType);

  await client.query(
    `UPDATE illustrations SET "imageUrl" = $1, "updatedAt" = NOW() WHERE "illustrationId" = $2`,
    [storedUrl, row.illustrationId],
  );

  console.log(JSON.stringify({ illustrationId: row.illustrationId, storageKey, storedUrl }, null, 2));
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
