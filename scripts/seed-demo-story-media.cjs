require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const axios = require('axios');
const { Client } = require('pg');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const DEMO_STORY_SLUG = process.env.DEMO_STORY_SLUG || 'moon-river-chase';
const DEMO_MEDIA_VERSION = process.env.DEMO_MEDIA_VERSION || 'a2-v2';
const FORCE_MEDIA = process.env.DEMO_FORCE_MEDIA === 'true';
const REFRESH_TEXT = process.env.DEMO_REFRESH_TEXT === 'true';

function env(...keys) {
  return keys.map((key) => process.env[key]).find(Boolean);
}

function getCloudflareS3ApiUrl() {
  const rawUrl = env('CLOUDFLARE_S3_API');
  if (!rawUrl) return undefined;
  return new URL(rawUrl);
}

function getR2Config() {
  const r2Url = getCloudflareS3ApiUrl();
  const accountId = env('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID') || r2Url?.hostname.match(/^([^.]+)\.r2\.cloudflarestorage\.com$/)?.[1];
  const endpoint =
    env('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT') ||
    r2Url?.origin ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  const bucket =
    env('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET') ||
    r2Url?.pathname.split('/').filter(Boolean)[0];
  const accessKeyId =
    env('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_ACCESS_KEY_ID') ||
    (r2Url?.username ? decodeURIComponent(r2Url.username) : undefined);
  const secretAccessKey =
    env('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_SECRET_ACCESS_KEY') ||
    (r2Url?.password ? decodeURIComponent(r2Url.password) : undefined);

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('Cloudflare R2 storage is not configured');
  }

  return { endpoint, bucket, accessKeyId, secretAccessKey, accountId, r2Url };
}

function getPublicUrl(key, bucket, config) {
  const publicUrl = env('R2_PUBLIC_URL', 'CLOUDFLARE_R2_PUBLIC_URL');
  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, '')}/${key}`;
  }
  if (config.r2Url) {
    return `${config.r2Url.origin}/${bucket}/${key}`;
  }
  return `https://${bucket}.${config.accountId}.r2.cloudflarestorage.com/${key}`;
}

async function uploadToR2(s3, config, key, body, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return getPublicUrl(key, config.bucket, config);
}

function getDbClient() {
  return new Client({
    host: env('DB_HOST', 'DATABASE_HOST'),
    port: parseInt(env('DB_PORT', 'DATABASE_PORT') || '5432', 10),
    user: env('DB_USERNAME', 'DATABASE_USER'),
    password: env('DB_PASSWORD', 'DATABASE_PASSWORD'),
    database: env('DB_NAME', 'DATABASE_NAME') || 'postgres',
    ssl: env('DB_SSL', 'DATABASE_SSL') === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function generateTts(text) {
  const apiKey = env('OPEN_ROUTER_API_KEY', 'OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OPEN_ROUTER_API_KEY is not configured');
  }
  const response = await axios.post(
    'https://openrouter.ai/api/v1/audio/speech',
    {
      input: text.replace(/\s+/g, ' ').trim(),
      model: env('OPENROUTER_TTS_MODEL') || 'hexgrad/kokoro-82m',
      voice: env('OPENROUTER_TTS_VOICE') || 'bm_lewis',
      response_format: 'mp3',
      speed: 0.82,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 120000,
    },
  );
  return Buffer.from(response.data);
}

function pixazoHeaders() {
  const apiKey = env('PIXAZO_API_KEY');
  if (!apiKey) {
    throw new Error('PIXAZO_API_KEY is not configured');
  }
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Ocp-Apim-Subscription-Key': apiKey,
  };
}

function extractPixazoImageUrl(payload) {
  if (!payload) return null;
  if (typeof payload.output === 'string') return payload.output;
  if (typeof payload.image_url === 'string') return payload.image_url;
  if (typeof payload.imageUrl === 'string') return payload.imageUrl;
  if (typeof payload.url === 'string') return payload.url;
  const media = payload.output?.media_url;
  if (Array.isArray(media) && media[0]) return media[0];
  if (Array.isArray(payload.image_urls) && payload.image_urls[0]) return payload.image_urls[0];
  if (Array.isArray(payload.images) && payload.images[0]) return payload.images[0];
  return null;
}

async function fetchPixazoStatus(requestId) {
  const response = await axios.get(`https://gateway.pixazo.ai/v2/requests/status/${requestId}`, {
    headers: pixazoHeaders(),
    timeout: Number(process.env.PIXAZO_REQUEST_TIMEOUT_MS || 180000),
  });
  return response.data || {};
}

async function pollPixazo(requestId) {
  const started = Date.now();
  const timeoutMs = Number(process.env.PIXAZO_POLL_TIMEOUT_MS || 600000);
  while (Date.now() - started < timeoutMs) {
    const payload = await fetchPixazoStatus(requestId);
    const status = String(payload.status || '').toUpperCase();
    if (status === 'COMPLETED') return payload;
    if (status === 'FAILED' || status === 'ERROR') {
      throw new Error(`Pixazo job failed for ${requestId}: ${JSON.stringify(payload).slice(0, 500)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Pixazo poll timeout for ${requestId}`);
}

async function generateImage(prompt) {
  const response = await axios.post(
    'https://gateway.pixazo.ai/gpt-image-2/v1/text-to-image',
    {
      prompt,
      size: process.env.PIXAZO_IMAGE_SIZE || '1536x1024',
      quality: process.env.PIXAZO_IMAGE_QUALITY || 'low',
    },
    {
      headers: pixazoHeaders(),
      timeout: Number(process.env.PIXAZO_REQUEST_TIMEOUT_MS || 180000),
    },
  );
  let payload = response.data;
  const requestId = payload?.request_id;
  if (requestId && !extractPixazoImageUrl(payload)) {
    payload = await pollPixazo(requestId);
  }
  const url = extractPixazoImageUrl(payload);
  if (!url) {
    throw new Error(`Pixazo did not return an image URL: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return url;
}

async function main() {
  const db = getDbClient();
  const r2 = getR2Config();
  const s3 = new S3Client({
    region: 'auto',
    endpoint: r2.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
  });

  await db.connect();
  try {
    if (REFRESH_TEXT) {
      const content = require('../dist/demo-story/demo-story.content.js');
      const story = content.demoStoryContent;
      await db.query(
        `INSERT INTO demo_stories ("demoStoryId", slug, title, scenario, framework, status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::jsonb, 'text_seeded', now(), now())
         ON CONFLICT ("demoStoryId") DO UPDATE
         SET slug = EXCLUDED.slug,
             title = EXCLUDED.title,
             scenario = EXCLUDED.scenario,
             framework = EXCLUDED.framework,
             status = CASE WHEN demo_stories.status = 'ready' THEN 'text_seeded' ELSE demo_stories.status END,
             "updatedAt" = now()`,
        [
          story.demoStoryId,
          story.slug,
          story.title,
          story.scenario,
          JSON.stringify(story.framework),
        ],
      );

      for (const node of content.demoStoryNodes) {
        await db.query(
          `INSERT INTO demo_story_nodes (
             "nodeId", "demoStoryId", "nodeKey", "episodeNumber", title, "chapterText",
             "introOptionsPhrase", "highlightedVocabulary", choices, "illustrationPrompt",
             "imageUrl", "audioChunks", "isStart", "isEnding", "createdAt", "updatedAt"
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, NULL, '[]'::jsonb, $11, $12, now(), now())
           ON CONFLICT ("nodeId") DO UPDATE
           SET "nodeKey" = EXCLUDED."nodeKey",
               "episodeNumber" = EXCLUDED."episodeNumber",
               title = EXCLUDED.title,
               "chapterText" = EXCLUDED."chapterText",
               "introOptionsPhrase" = EXCLUDED."introOptionsPhrase",
               "highlightedVocabulary" = EXCLUDED."highlightedVocabulary",
               choices = EXCLUDED.choices,
               "illustrationPrompt" = EXCLUDED."illustrationPrompt",
               "imageUrl" = CASE WHEN $13 THEN NULL ELSE demo_story_nodes."imageUrl" END,
               "audioChunks" = CASE WHEN $13 THEN '[]'::jsonb ELSE demo_story_nodes."audioChunks" END,
               "isStart" = EXCLUDED."isStart",
               "isEnding" = EXCLUDED."isEnding",
               "updatedAt" = now()`,
          [
            node.nodeId,
            story.demoStoryId,
            node.nodeKey,
            node.episodeNumber,
            node.title,
            node.chapterText,
            node.introOptionsPhrase,
            JSON.stringify(node.highlightedVocabulary),
            JSON.stringify(node.choices),
            node.illustrationPrompt,
            node.nodeKey === story.framework.branching.start,
            Boolean(node.isEnding),
            FORCE_MEDIA,
          ],
        );
      }

      process.stdout.write(`Text seed refreshed for ${story.slug}; forceMedia=${FORCE_MEDIA}\n`);
    }

    const result = await db.query(
      `SELECT n.*
       FROM demo_story_nodes n
       JOIN demo_stories s ON s."demoStoryId" = n."demoStoryId"
       WHERE s.slug = $1
       ORDER BY n."episodeNumber" ASC, n."nodeKey" ASC`,
      [DEMO_STORY_SLUG],
    );

    if (!result.rows.length) {
      throw new Error(`No demo story nodes found for slug ${DEMO_STORY_SLUG}. Run POST /demo-story/seed/text first.`);
    }

    const summary = [];
    for (const node of result.rows) {
      const audioChunks = Array.isArray(node.audioChunks) ? node.audioChunks : [];
      const audioById = FORCE_MEDIA ? new Map() : new Map(audioChunks.map((chunk) => [chunk.id, chunk]));
      const choices = Array.isArray(node.choices) ? node.choices : [];
      const desiredAudio = [
        { id: 'chapter', type: 'chapter', text: node.chapterText },
        ...(node.introOptionsPhrase ? [{ id: 'intro', type: 'intro', text: node.introOptionsPhrase }] : []),
        ...choices.map((choice) => ({
          id: `choice-${choice.id}`,
          type: 'choice',
          choiceId: choice.id,
          text: choice.text,
        })),
      ];

      for (const item of desiredAudio) {
        const existing = audioById.get(item.id);
        if (existing?.audioUrl) continue;
        process.stdout.write(`TTS ${node.nodeKey}/${item.id}...\n`);
        const audioBuffer = await generateTts(item.text);
        const storageKey = `demo-story/${DEMO_STORY_SLUG}/${DEMO_MEDIA_VERSION}/audio/${node.nodeKey}-${item.id}.mp3`;
        const audioUrl = await uploadToR2(s3, r2, storageKey, audioBuffer, 'audio/mpeg');
        audioById.set(item.id, {
          id: item.id,
          type: item.type,
          choiceId: item.choiceId || null,
          text: item.text,
          status: 'ready',
          audioUrl,
        });
      }

      let imageUrl = FORCE_MEDIA ? null : node.imageUrl;
      if (!imageUrl) {
        process.stdout.write(`Image ${node.nodeKey}...\n`);
        const remoteUrl = await generateImage(node.illustrationPrompt);
        const imageResponse = await axios.get(remoteUrl, {
          responseType: 'arraybuffer',
          timeout: 120000,
        });
        const storageKey = `demo-story/${DEMO_STORY_SLUG}/${DEMO_MEDIA_VERSION}/images/${node.nodeKey}.png`;
        imageUrl = await uploadToR2(
          s3,
          r2,
          storageKey,
          Buffer.from(imageResponse.data),
          imageResponse.headers['content-type'] || 'image/png',
        );
      }

      const nextAudioChunks = Array.from(audioById.values());
      await db.query(
        `UPDATE demo_story_nodes
         SET "imageUrl" = $1, "audioChunks" = $2::jsonb, "updatedAt" = now()
         WHERE "nodeId" = $3`,
        [imageUrl, JSON.stringify(nextAudioChunks), node.nodeId],
      );

      summary.push({
        nodeKey: node.nodeKey,
        imageReady: Boolean(imageUrl),
        audioReady: nextAudioChunks.filter((chunk) => chunk.audioUrl).length,
      });
    }

    await db.query(
      `UPDATE demo_stories SET status = 'ready', "updatedAt" = now() WHERE slug = $1`,
      [DEMO_STORY_SLUG],
    );

    console.log(JSON.stringify({ status: 'ready', results: summary }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  const status = error?.response?.status || error?.code || 'N/A';
  const body = error?.response?.data;
  console.error(`[seed-demo-story-media] failed status=${status}: ${error?.message || error}`);
  if (body) {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body);
    console.error(text.slice(0, 1000));
  }
  process.exit(1);
});
