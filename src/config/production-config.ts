function hasAny(...keys: string[]) {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing: string[] = [];
  if (!hasAny('DATABASE_URL')) missing.push('DATABASE_URL');
  if (!hasAny('FRONTEND_URL')) missing.push('FRONTEND_URL');
  if (!hasAny('BACKEND_URL')) missing.push('BACKEND_URL');
  if (!hasAny('ALLOWED_ORIGINS')) missing.push('ALLOWED_ORIGINS');
  if (!hasAny('SESSION_COOKIE_DOMAIN')) missing.push('SESSION_COOKIE_DOMAIN');
  if (!hasAny('HEALTH_DIAGNOSTICS_TOKEN')) missing.push('HEALTH_DIAGNOSTICS_TOKEN');
  if (!hasAny('OPEN_ROUTER_API_KEY', 'OPENROUTER_API_KEY')) missing.push('OPEN_ROUTER_API_KEY');
  if (!hasAny('PIXAZO_API_KEY')) missing.push('PIXAZO_API_KEY');
  if (!hasAny('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET')) missing.push('R2_BUCKET');
  const rawR2Url = process.env.CLOUDFLARE_S3_API?.trim();
  let urlHasCredentials = false;
  if (rawR2Url) {
    try {
      const parsed = new URL(rawR2Url);
      urlHasCredentials = Boolean(parsed.username && parsed.password);
    } catch {
      throw new Error('Production config invalid: CLOUDFLARE_S3_API must be a valid URL');
    }
  }
  const hasR2Endpoint = Boolean(rawR2Url) || hasAny('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT');
  const hasR2Credentials = urlHasCredentials || (
    hasAny('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_ACCESS_KEY_ID')
    && hasAny('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_SECRET_ACCESS_KEY')
  );
  if (!hasR2Endpoint || !hasR2Credentials) missing.push('R2 endpoint and access credentials');

  if (process.env.DB_SYNCHRONIZE === 'true' || process.env.DATABASE_SYNCHRONIZE === 'true') {
    throw new Error('Production config invalid: DB_SYNCHRONIZE must be false');
  }
  if (process.env.WORKER_ENABLED !== 'true') {
    throw new Error('Production config invalid: WORKER_ENABLED must be true for the single-replica alpha topology');
  }
  if (missing.length > 0) {
    throw new Error(`Production config missing: ${missing.join(', ')}`);
  }

  const frontendUrl = new URL(process.env.FRONTEND_URL!);
  const backendUrl = new URL(process.env.BACKEND_URL!);
  if (frontendUrl.protocol !== 'https:' || backendUrl.protocol !== 'https:') {
    throw new Error('Production config invalid: FRONTEND_URL and BACKEND_URL must use HTTPS');
  }
}
