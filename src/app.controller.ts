import { Controller, Get, Headers, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppService } from './app.service';
import { OpenRouterService } from './openrouter/openrouter.service';
import { PixazoService } from './pixazo/pixazo.service';
import { StorageService } from './storage/storage.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly openRouter: OpenRouterService,
    private readonly pixazo: PixazoService,
    private readonly storage: StorageService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('live')
  live() {
    return { status: 'ok', service: 'storyhop-backend' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', database: 'ready', migrations: 'ready' };
    } catch (error) {
      throw new ServiceUnavailableException({ status: 'not_ready', database: 'unavailable' });
    }
  }

  @Get('health/dependencies')
  async dependencies(@Headers('x-health-token') token?: string) {
    this.assertDependencyHealthAccess(token);
    let models: Awaited<ReturnType<OpenRouterService['checkModelsHealth']>> = [];
    let openRouterError: string | undefined;
    try {
      models = await this.openRouter.checkModelsHealth();
    } catch (error) {
      openRouterError = this.safeDependencyError(error);
    }
    let r2 = { available: true, error: undefined as string | undefined };
    try { this.storage.getBucket(); this.storage.getClient(); } catch (error) { r2 = { available: false, error: this.safeDependencyError(error) }; }
    const openRouterAvailable = !openRouterError && models.length > 0 && models.every((model) => model.available);
    const pixazoConfigured = Boolean(process.env.PIXAZO_API_KEY);
    return {
      status: openRouterAvailable && pixazoConfigured && r2.available ? 'ok' : 'degraded',
      openRouter: { available: openRouterAvailable, models, ...(openRouterError ? { error: openRouterError } : {}) },
      pixazo: { configured: pixazoConfigured, model: this.pixazo.getImageModelLabel() },
      r2,
    };
  }

  @Get('health')
  async getHealth(@Headers('x-health-token') token?: string) { return this.dependencies(token); }

  private assertDependencyHealthAccess(token?: string) {
    const expected = process.env.HEALTH_DIAGNOSTICS_TOKEN;
    if (process.env.NODE_ENV === 'production' && (!expected || token !== expected)) {
      throw new NotFoundException('Not found');
    }
  }

  private safeDependencyError(error: unknown) {
    const candidate = error as { response?: { status?: number }; code?: string };
    return String(candidate?.response?.status || candidate?.code || 'unavailable');
  }
}
