import { validateProductionConfig } from './production-config';

describe('production configuration', () => {
  const original = { ...process.env };
  const valid = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://user:pass@db:5432/storyhop',
    FRONTEND_URL: 'https://app.story-hop.com',
    BACKEND_URL: 'https://api.story-hop.com',
    ALLOWED_ORIGINS: 'https://app.story-hop.com',
    SESSION_COOKIE_DOMAIN: '.story-hop.com',
    HEALTH_DIAGNOSTICS_TOKEN: 'health-secret',
    OPEN_ROUTER_API_KEY: 'openrouter-secret',
    PIXAZO_API_KEY: 'pixazo-secret',
    R2_BUCKET: 'storyhop',
    CLOUDFLARE_S3_API: 'https://key:secret@account.r2.cloudflarestorage.com/storyhop',
    WORKER_ENABLED: 'true',
    DB_SYNCHRONIZE: 'false',
  };

  beforeEach(() => {
    process.env = { ...original, ...valid };
  });
  afterAll(() => { process.env = original; });

  it('accepts the closed-alpha topology', () => {
    expect(() => validateProductionConfig()).not.toThrow();
  });

  it('fails before startup when a public backend URL is missing', () => {
    delete process.env.BACKEND_URL;
    expect(() => validateProductionConfig()).toThrow('BACKEND_URL');
  });

  it('rejects schema synchronization in production', () => {
    process.env.DB_SYNCHRONIZE = 'true';
    expect(() => validateProductionConfig()).toThrow('DB_SYNCHRONIZE must be false');
  });

  it('rejects an R2 endpoint URL without separate credentials', () => {
    process.env.CLOUDFLARE_S3_API = 'https://account.r2.cloudflarestorage.com/storyhop';
    delete process.env.CLOUDFLARE_ACCESS_KEY_ID;
    delete process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
    expect(() => validateProductionConfig()).toThrow('R2 endpoint and access credentials');
  });
});
