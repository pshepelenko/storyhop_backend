import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { OpenRouterService } from '../src/openrouter/openrouter.service';
import { PixazoService } from '../src/pixazo/pixazo.service';
import { StorageService } from '../src/storage/storage.service';

describe('Release health endpoints (e2e)', () => {
  let app: INestApplication;
  const query = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: getDataSourceToken(), useValue: { query } },
        {
          provide: OpenRouterService,
          useValue: {
            checkModelsHealth: jest.fn().mockResolvedValue([
              { model: 'text', available: true },
              { model: 'tts', available: true },
            ]),
          },
        },
        {
          provide: PixazoService,
          useValue: { getImageModelLabel: jest.fn().mockReturnValue('gpt-image-2') },
        },
        {
          provide: StorageService,
          useValue: { getBucket: jest.fn().mockReturnValue('test'), getClient: jest.fn().mockReturnValue({}) },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    query.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    delete process.env.PIXAZO_API_KEY;
  });

  it('exposes a process-only liveness check', async () => {
    await request(app.getHttpServer())
      .get('/live')
      .expect(200)
      .expect({ status: 'ok', service: 'storyhop-backend' });
  });

  it('reports readiness when PostgreSQL is reachable', async () => {
    await request(app.getHttpServer())
      .get('/ready')
      .expect(200)
      .expect({ status: 'ok', database: 'ready', migrations: 'ready' });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 readiness when PostgreSQL is unavailable', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'));

    await request(app.getHttpServer())
      .get('/ready')
      .expect(503)
      .expect(({ body }) => {
        expect(body).toEqual({ status: 'not_ready', database: 'unavailable' });
      });
  });

  it('reports dependency status without exposing credentials', async () => {
    process.env.PIXAZO_API_KEY = 'test-key';

    await request(app.getHttpServer())
      .get('/health/dependencies')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
        expect(body.openRouter.available).toBe(true);
        expect(body.pixazo).toEqual({ configured: true, model: 'gpt-image-2' });
        expect(body.r2.available).toBe(true);
        expect(JSON.stringify(body)).not.toContain('test-key');
      });
  });
});
