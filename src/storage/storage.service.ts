import { Injectable } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class StorageService {
  private client?: S3Client;
  private bucket?: string;

  private getConfig() {
    const r2Url = this.getCloudflareS3ApiUrl();
    const accountId = this.env('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID') || this.getAccountIdFromUrl(r2Url);
    const endpoint =
      this.env('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT') ||
      (r2Url ? r2Url.origin : undefined) ||
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    const credentials = this.getCredentialsFromUrl(r2Url);
    const accessKeyId =
      this.env('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_ACCESS_KEY_ID') ||
      credentials?.accessKeyId;
    const secretAccessKey =
      this.env('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_SECRET_ACCESS_KEY') ||
      credentials?.secretAccessKey;

    return { endpoint, accessKeyId, secretAccessKey, accountId, r2Url };
  }

  getClient(): S3Client {
    if (this.client) {
      return this.client;
    }
    const { endpoint, accessKeyId, secretAccessKey } = this.getConfig();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('Cloudflare R2 storage is not configured');
    }
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    return this.client;
  }

  getBucket(): string {
    if (this.bucket) {
      return this.bucket;
    }
    const bucket =
      this.env('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET') ||
      this.getBucketFromUrl(this.getCloudflareS3ApiUrl());
    if (!bucket) {
      throw new Error('Cloudflare R2 bucket is not configured');
    }
    this.bucket = bucket;
    return this.bucket;
  }

  async download(
    key: string,
    range?: string,
  ): Promise<{ body: Buffer; contentType: string; contentLength: number; contentRange?: string }> {
    const bucket = this.getBucket();
    const result = await this.getClient().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    );

    const chunks: Buffer[] = [];
    if (result.Body) {
      const stream = result.Body as any;
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
    }

    return {
      body: Buffer.concat(chunks),
      contentType: result.ContentType || 'application/octet-stream',
      contentLength: result.ContentLength ?? Buffer.concat(chunks).length,
      contentRange: result.ContentRange,
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.getClient().send(
        new HeadObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
        }),
      );
      return true;
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      if (status === 404 || error?.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    const bucket = this.getBucket();
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return this.getPublicUrl(key, bucket);
  }

  extractKeyFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/storage-proxy')) {
        const proxyKey = parsed.searchParams.get('key');
        if (proxyKey) return proxyKey;
      }
    } catch {
      // Keep matching legacy direct-storage URLs below.
    }
    const bucket = this.getBucket();
    const patterns = [
      new RegExp(`/${bucket}/([^?]+)`),
      new RegExp(`r2\\.cloudflarestorage\\.com/${bucket}/([^?]+)`),
    ];
    const publicUrl = this.env('R2_PUBLIC_URL', 'CLOUDFLARE_R2_PUBLIC_URL');
    if (publicUrl) {
      const escaped = publicUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(new RegExp(`${escaped}/([^?]+)`));
    }
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  getProxyUrl(key: string): string {
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    return `${backendUrl}/storage-proxy?key=${encodeURIComponent(key)}`;
  }

  private getPublicUrl(key: string, bucket: string): string {
    const publicUrl = this.env('R2_PUBLIC_URL', 'CLOUDFLARE_R2_PUBLIC_URL');
    if (publicUrl) {
      return `${publicUrl.replace(/\/$/, '')}/${key}`;
    }

    const { r2Url, accountId } = this.getConfig();
    if (r2Url) {
      return `${r2Url.origin}/${bucket}/${key}`;
    }
    if (!accountId) {
      throw new Error('Cannot construct public URL for R2 storage');
    }
    return `https://${bucket}.${accountId}.r2.cloudflarestorage.com/${key}`;
  }

  private env(...keys: string[]): string | undefined {
    return keys.map((key) => process.env[key]).find(Boolean);
  }

  private getCloudflareS3ApiUrl(): URL | undefined {
    const rawUrl = this.env('CLOUDFLARE_S3_API');
    if (!rawUrl) return undefined;
    try {
      return new URL(rawUrl);
    } catch {
      throw new Error('CLOUDFLARE_S3_API must be a valid URL');
    }
  }

  private getAccountIdFromUrl(url?: URL): string | undefined {
    return url?.hostname.match(/^([^.]+)\.r2\.cloudflarestorage\.com$/)?.[1];
  }

  private getBucketFromUrl(url?: URL): string | undefined {
    return url?.pathname.split('/').filter(Boolean)[0];
  }

  private getCredentialsFromUrl(url?: URL): { accessKeyId: string; secretAccessKey: string } | undefined {
    if (!url?.username || !url?.password) return undefined;
    return {
      accessKeyId: decodeURIComponent(url.username),
      secretAccessKey: decodeURIComponent(url.password),
    };
  }
}
