const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

function loadEnv(envPath) {
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function env(...keys) {
  return keys.map((key) => process.env[key]).find(Boolean);
}

function getCloudflareS3ApiUrl() {
  const rawUrl = process.env.CLOUDFLARE_S3_API;
  return rawUrl ? new URL(rawUrl) : undefined;
}

async function main() {
  loadEnv(path.join(__dirname, '..', '.env'));

  const key =
    process.argv[2] ||
    'images/seasons/c01885b7-21ea-4adb-bac2-e14820a0001f/storybook/de4a64bd-bf7f-488d-9b8e-b107b20c38bc.png';

  const r2Url = getCloudflareS3ApiUrl();
  const accountId =
    env('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID') ||
    r2Url?.hostname.match(/^([^.]+)\.r2\.cloudflarestorage\.com$/)?.[1];
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

  const client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  const summary = { endpoint, bucket, key };

  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    summary.head = {
      contentType: head.ContentType,
      contentLength: head.ContentLength,
      etag: head.ETag,
    };
  } catch (error) {
    summary.headError = {
      name: error?.name,
      message: error?.message,
      code: error?.Code || error?.code,
      httpStatusCode: error?.$metadata?.httpStatusCode,
    };
  }

  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    let bytes = 0;
    for await (const chunk of object.Body) {
      bytes += Buffer.from(chunk).length;
      if (bytes > 1024) break;
    }
    summary.get = {
      contentType: object.ContentType,
      bytesRead: bytes,
      httpStatusCode: object.$metadata?.httpStatusCode,
    };
  } catch (error) {
    summary.getError = {
      name: error?.name,
      message: error?.message,
      code: error?.Code || error?.code,
      httpStatusCode: error?.$metadata?.httpStatusCode,
    };
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
