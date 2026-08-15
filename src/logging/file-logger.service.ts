import { Injectable, LoggerService } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileLogger implements LoggerService {
  private logDir: string;
  private logFile: string;
  private errorFile: string;

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      this.logDir = '';
      this.logFile = '';
      this.errorFile = '';
      return;
    }
    this.logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    this.logFile = path.join(this.logDir, `app-${today}.log`);
    this.errorFile = path.join(this.logDir, `error-${today}.log`);
  }

  private write(file: string, level: string, message: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}\n`;
    if (file) {
      try {
        fs.appendFileSync(file, line);
      } catch {
        // Files are a local-development convenience. Production logs are stdout.
      }
    }
    if (level === 'ERROR') {
      console.error(line.trim());
    } else {
      console.log(line.trim());
    }
  }

  log(message: string) {
    this.write(this.logFile, 'INFO', message);
  }

  error(message: string, trace?: string) {
    const full = trace ? `${message}\n${trace}` : message;
    this.write(this.errorFile, 'ERROR', full);
    this.write(this.logFile, 'ERROR', full);
  }

  warn(message: string) {
    this.write(this.logFile, 'WARN', message);
  }

  debug(message: string) {
    this.write(this.logFile, 'DEBUG', message);
  }

  verbose(message: string) {
    this.write(this.logFile, 'VERBOSE', message);
  }

  logOpenRouterError(context: string, error: any) {
    const code = error?.code || error?.cause?.code || error?.response?.status || 'unknown';
    const msg = error?.message || 'no message';
    const status = error?.response?.status || 'N/A';
    const data = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 500) : 'N/A';

    this.error(
      `[OpenRouter] ${context} failed | status=${status} code=${code} | ${msg} | body=${data}`,
    );
  }

  logInvalidLlmResponse(context: string, raw: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const response = String(raw || '').slice(0, 30000);

    this.error(
      `[OpenRouter] ${context} returned invalid JSON | parseError=${message} | raw=${JSON.stringify(response)}`,
    );
  }

  logOpenRouterUnavailable(context: string, attempt: number, error: any) {
    const code = error?.code || error?.cause?.code || error?.response?.status || 'unknown';
    const msg = error?.message || 'no message';

    this.error(
      `[OpenRouter] MODEL UNAVAILABLE | context=${context} attempt=${attempt} | ${code}: ${msg}`,
    );
  }

  logPixazoError(context: string, error: any) {
    const code = error?.code || error?.cause?.code || error?.response?.status || 'unknown';
    const msg = error?.message || 'no message';
    const status = error?.response?.status || 'N/A';
    const data = error?.response?.data ? JSON.stringify(error.response.data).slice(0, 500) : 'N/A';

    this.error(
      `[Pixazo] ${context} failed | status=${status} code=${code} | ${msg} | body=${data}`,
    );
  }

  logEpisodePipeline(event: string, data: Record<string, unknown>) {
    this.log(`[EpisodePipeline] ${event} ${JSON.stringify(data)}`);
  }

  logIllustrationStorageError(
    step: 'pixazo_download' | 'r2_upload',
    storageKey: string,
    sourceUrl: string,
    error: any,
    attempt?: number,
    maxAttempts?: number,
  ) {
    const code = error?.code || error?.cause?.code || error?.response?.status || 'unknown';
    const msg = error?.message || 'no message';
    const status = error?.response?.status || 'N/A';
    const attemptLabel =
      attempt && maxAttempts ? ` attempt=${attempt}/${maxAttempts}` : '';
    const safeUrl = String(sourceUrl || '').slice(0, 180);

    this.error(
      `[Illustration] ${step} failed${attemptLabel} | key=${storageKey} | url=${safeUrl} | status=${status} code=${code} | ${msg}`,
    );
  }
}
