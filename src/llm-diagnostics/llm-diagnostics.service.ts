import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { FileLogger } from '../logging/file-logger.service';
import { LlmGenerationDiagnostic } from './entities/llm-generation-diagnostic.entity';

export type LlmDiagnosticInput = Omit<LlmGenerationDiagnostic, 'diagnosticId' | 'createdAt' | 'expiresAt' | 'payloadCiphertext' | 'encryptionIv' | 'encryptionAuthTag'> & {
  payload?: Record<string, unknown>;
};

@Injectable()
export class LlmDiagnosticsService {
  private readonly retentionDays = 30;
  private readonly encryptionKey: Buffer | null;

  constructor(
    @InjectRepository(LlmGenerationDiagnostic)
    private readonly repository: Repository<LlmGenerationDiagnostic>,
    private readonly logger: FileLogger,
  ) {
    this.encryptionKey = this.readEncryptionKey();
  }

  async record(input: LlmDiagnosticInput): Promise<string | null> {
    try {
      const now = new Date();
      const encrypted = input.payload ? this.encrypt(input.payload) : null;
      const entity = this.repository.create({
        diagnosticId: uuidv4(),
        ...input,
        requestedProvider: input.requestedProvider || null,
        actualProvider: input.actualProvider || null,
        durationMs: input.durationMs || null,
        httpStatus: input.httpStatus || null,
        responseId: input.responseId || null,
        finishReason: input.finishReason || null,
        usage: input.usage || null,
        validationIssues: input.validationIssues || null,
        payloadCiphertext: encrypted?.ciphertext || null,
        encryptionIv: encrypted?.iv || null,
        encryptionAuthTag: encrypted?.authTag || null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.retentionDays * 24 * 60 * 60 * 1000),
      });

      await this.repository.save(entity);
      return entity.diagnosticId;
    } catch (error) {
      this.logger.error(`[LlmDiagnostics] failed to persist metadata: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async purgeExpired(): Promise<number> {
    try {
      const result = await this.repository
        .createQueryBuilder()
        .delete()
        .where('"expiresAt" < NOW()')
        .execute();
      return result.affected || 0;
    } catch (error) {
      this.logger.error(`[LlmDiagnostics] cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private readEncryptionKey(): Buffer | null {
    const raw = process.env.LLM_DIAGNOSTICS_ENCRYPTION_KEY?.trim();
    if (!raw) return null;
    try {
      const key = Buffer.from(raw, 'base64');
      if (key.length !== 32) throw new Error('must decode to 32 bytes');
      return key;
    } catch (error) {
      this.logger.error(`[LlmDiagnostics] invalid LLM_DIAGNOSTICS_ENCRYPTION_KEY: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private encrypt(payload: Record<string, unknown>): { ciphertext: string; iv: string; authTag: string } | null {
    if (!this.encryptionKey) {
      this.logger.warn('[LlmDiagnostics] payload omitted because LLM_DIAGNOSTICS_ENCRYPTION_KEY is not configured');
      return null;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }
}
