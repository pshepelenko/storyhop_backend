import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';

describe('AppController release health', () => {
  const appService = { getHello: jest.fn(() => 'Hello World!') };
  const openRouter = { checkModelsHealth: jest.fn() };
  const pixazo = { getImageModelLabel: jest.fn(() => 'gpt-image-2') };
  const storage = { getBucket: jest.fn(() => 'storyhop'), getClient: jest.fn(() => ({})) };
  const dataSource = { query: jest.fn() };
  let controller: AppController;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.HEALTH_DIAGNOSTICS_TOKEN;
    process.env.NODE_ENV = 'test';
    controller = new AppController(
      appService as any,
      openRouter as any,
      pixazo as any,
      storage as any,
      dataSource as any,
    );
  });

  afterAll(() => {
    delete process.env.HEALTH_DIAGNOSTICS_TOKEN;
    delete process.env.NODE_ENV;
  });

  it('keeps liveness independent from external dependencies', () => {
    expect(controller.live()).toEqual({ status: 'ok', service: 'storyhop-backend' });
    expect(openRouter.checkModelsHealth).not.toHaveBeenCalled();
  });

  it('reports readiness only after a database query succeeds', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    await expect(controller.ready()).resolves.toEqual({ status: 'ok', database: 'ready', migrations: 'ready' });
  });

  it('returns 503 when the database is unavailable', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns a degraded dependency report instead of throwing', async () => {
    openRouter.checkModelsHealth.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
    const report = await controller.dependencies();
    expect(report.status).toBe('degraded');
    expect(report.openRouter).toEqual({ available: false, models: [], error: '403' });
  });

  it('hides dependency diagnostics in production without the configured token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.HEALTH_DIAGNOSTICS_TOKEN = 'secret';
    await expect(controller.dependencies()).rejects.toMatchObject({ status: 404 });
  });
});
