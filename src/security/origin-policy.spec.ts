import { configuredAllowedOrigins, isAllowedBrowserOrigin } from './origin-policy';

describe('browser origin policy', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows private network origins during local development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOWED_ORIGINS;
    expect(isAllowedBrowserOrigin('http://192.168.1.20:3001')).toBe(true);
  });

  it('does not allow private network origins in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOWED_ORIGINS;
    expect(configuredAllowedOrigins()).toEqual(['https://app.story-hop.com']);
    expect(isAllowedBrowserOrigin('http://192.168.1.20:3001')).toBe(false);
  });

  it('uses an explicit production allowlist', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://preview.story-hop.com, https://app.story-hop.com';
    expect(isAllowedBrowserOrigin('https://preview.story-hop.com')).toBe(true);
    expect(isAllowedBrowserOrigin('https://other.example')).toBe(false);
  });
});
