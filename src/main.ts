import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FileLogger } from './logging/file-logger.service';
import { configuredAllowedOrigins, isAllowedBrowserOrigin } from './security/origin-policy';
import { validateProductionConfig } from './config/production-config';

async function bootstrap() {
  validateProductionConfig();
  const port = Number(process.env.PORT || 3000);
  const fileLogger = new FileLogger();
  const app = await NestFactory.create(AppModule, { logger: fileLogger });
  app.enableShutdownHooks();
  const allowedOrigins = configuredAllowedOrigins();
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || isAllowedBrowserOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  await app.listen(port, '0.0.0.0');
  fileLogger.log(`[Bootstrap] Listening on port ${port}`);
}

bootstrap().catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    const port = process.env.PORT || 3000;
    console.error(
      `[Bootstrap] Port ${port} is already in use. Run "npm run free-port" in backend/ or stop the other process, then retry.`,
    );
  } else {
    console.error('[Bootstrap] Failed to start:', error);
  }
  process.exit(1);
});
