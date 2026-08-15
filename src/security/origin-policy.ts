const PRODUCTION_APP_ORIGIN = 'https://app.story-hop.com';
const LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
];

export function configuredAllowedOrigins(): string[] {
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  return process.env.NODE_ENV === 'production' ? [PRODUCTION_APP_ORIGIN] : LOCAL_ORIGINS;
}

export function isPrivateDevelopmentOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;

    const private172 = hostname.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    const secondOctet = private172 ? Number(private172[1]) : -1;
    return secondOctet >= 16 && secondOctet <= 31;
  } catch {
    return false;
  }
}

export function isAllowedBrowserOrigin(origin: string): boolean {
  if (configuredAllowedOrigins().includes(origin)) return true;
  return process.env.NODE_ENV !== 'production' && isPrivateDevelopmentOrigin(origin);
}
