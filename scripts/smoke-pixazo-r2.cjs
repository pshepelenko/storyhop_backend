/* Intentionally opt-in: a real Pixazo request has cost and creates an R2 object. */
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
if (process.env.SMOKE_ALLOW_GENERATION !== 'true') {
  throw new Error('Set SMOKE_ALLOW_GENERATION=true to run the billable Pixazo/R2 smoke test.');
}
const axios = require('axios');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const env = (...keys) => keys.map((key) => process.env[key]).find(Boolean);
const apiKey = process.env.PIXAZO_API_KEY;
const rawS3Url = env('CLOUDFLARE_S3_API', 'R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT');
if (!rawS3Url) throw new Error('R2 endpoint configuration is required');
const s3Url = new URL(rawS3Url);
const bucket = process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET || s3Url.pathname.replace(/^\//, '').split('/')[0];
const smokeKey = process.env.SMOKE_R2_KEY || 'smoke/storyhop-alpha.png';
const accessKeyId = env('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_ACCESS_KEY_ID') || decodeURIComponent(s3Url.username);
const secretAccessKey = env('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_SECRET_ACCESS_KEY') || decodeURIComponent(s3Url.password);
if (!apiKey || !bucket || !accessKeyId || !secretAccessKey) throw new Error('PIXAZO_API_KEY and complete R2 configuration are required');

const headers = {
  'Ocp-Apim-Subscription-Key': apiKey,
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
};

function extractImageUrl(payload) {
  if (!payload) return null;
  if (typeof payload.output === 'string') return payload.output;
  if (typeof payload.image_url === 'string') return payload.image_url;
  if (typeof payload.imageUrl === 'string') return payload.imageUrl;
  if (typeof payload.url === 'string') return payload.url;
  if (Array.isArray(payload.output?.media_url)) return payload.output.media_url[0] || null;
  if (Array.isArray(payload.image_urls)) return payload.image_urls[0] || null;
  if (Array.isArray(payload.images)) return payload.images[0] || null;
  return null;
}

async function waitForImage(requestId) {
  const timeoutMs = Number(process.env.PIXAZO_POLL_TIMEOUT_MS || 180000);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await axios.get(`https://gateway.pixazo.ai/v2/requests/status/${requestId}`, {
      headers,
      timeout: 30000,
    });
    const payload = response.data || {};
    const status = String(payload.status || '').toUpperCase();
    const url = extractImageUrl(payload);
    if (status === 'COMPLETED' && url) return { payload, url };
    if (status === 'FAILED' || status === 'ERROR') {
      throw new Error(`Pixazo request ${requestId} failed: ${JSON.stringify(payload).slice(0, 500)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Pixazo request ${requestId} did not complete within ${timeoutMs}ms`);
}

(async () => {
  let requestId = null;
  let imageBody;
  let contentType = 'image/png';
  if (process.env.SMOKE_R2_ONLY === 'true') {
    imageBody = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
  } else {
    const image = await axios.post('https://gateway.pixazo.ai/gpt-image-2/v1/text-to-image', { prompt: 'A single small green crystal on a plain white background, child-safe 2D storybook illustration, no text.', size: '1024x1024', quality: 'low' }, { headers, timeout: 180000 });
    requestId = image.data?.request_id;
    let url = extractImageUrl(image.data);
    if (!url && requestId) ({ url } = await waitForImage(requestId));
    if (!url) throw new Error(`Pixazo did not return an image URL. requestId=${requestId || 'unknown'}`);
    const download = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
    contentType = String(download.headers['content-type'] || '');
    imageBody = Buffer.from(download.data);
    if (!contentType.startsWith('image/') || imageBody.byteLength < 1024) {
      throw new Error(`Pixazo returned an invalid image payload: contentType=${contentType}, bytes=${imageBody.byteLength}`);
    }
  }
  const endpoint = `${s3Url.protocol}//${s3Url.host}`;
  const client = new S3Client({ region: 'auto', endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: smokeKey, Body: imageBody, ContentType: contentType }));
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: smokeKey }));
  const minimumSize = process.env.SMOKE_R2_ONLY === 'true' ? 1 : 1024;
  if (!String(object.ContentType || '').startsWith('image/') || Number(object.ContentLength || 0) < minimumSize) {
    throw new Error(`R2 smoke read returned invalid metadata: contentType=${object.ContentType}, contentLength=${object.ContentLength}`);
  }
  console.log(JSON.stringify({ ok: true, requestId, smokeKey, contentType: object.ContentType, contentLength: object.ContentLength }));
})();
