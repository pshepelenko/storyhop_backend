import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FileLogger } from '../logging/file-logger.service';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { SpeakingAudioNormalizerService } from './speaking-audio-normalizer.service';

type UploadedAudio = {
  buffer: Buffer;
  size: number;
  mimetype: string;
};

const MAX_AUDIO_BYTES = 256 * 1024;
const MAX_ATTEMPTS_PER_MINUTE = 8;
const RATE_WINDOW_MS = 60 * 1000;

const FORMAT_BY_MIME: Record<string, 'm4a' | 'mp3' | 'webm'> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/webm': 'webm',
  'audio/webm;codecs=opus': 'webm',
};

@Injectable()
export class SpeakingTranscriptionService {
  private readonly attemptsByUser = new Map<string, number[]>();

  constructor(
    private readonly openRouter: OpenRouterService,
    private readonly logger: FileLogger,
    private readonly audioNormalizer: SpeakingAudioNormalizerService,
  ) {}

  async transcribe(ownerUserId: string, audio: UploadedAudio | undefined, durationMs?: number) {
    if (!audio?.buffer?.length || !audio.size) {
      throw new BadRequestException('Speaking audio is required');
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new PayloadTooLargeException('Speaking audio is too large');
    }

    const normalizedMimeType = String(audio.mimetype || '').toLowerCase().split(';', 1)[0].trim();
    const format = FORMAT_BY_MIME[normalizedMimeType];
    if (!format) {
      throw new BadRequestException('Unsupported speaking audio format');
    }

    this.assertRateLimit(ownerUserId);
    const safeDurationMs = Math.min(Math.max(Number(durationMs) || 0, 0), 12000);
    const inputSignature = this.audioNormalizer.describeContainer(audio.buffer);

    try {
      const normalizedAudio = await this.audioNormalizer.toMp3(audio.buffer);
      const result = await this.openRouter.transcribeAudio(normalizedAudio, 'mp3');
      this.logger.log(
        `[SpeakingSTT] completed inputMime=${normalizedMimeType} inputFormat=${format} inputSignature=${inputSignature} inputBytes=${audio.size} normalizedFormat=mp3 normalizedBytes=${normalizedAudio.length} durationMs=${safeDurationMs} model=${result.model} requestId=${result.requestId || 'none'} providerSeconds=${result.durationSeconds ?? 'none'} costUsd=${result.costUsd ?? 'none'}`,
      );
      return { transcript: result.transcript };
    } catch (error: any) {
      const status = Number(error?.response?.status || 0);
      this.logger.warn(
        `[SpeakingSTT] failed inputMime=${normalizedMimeType} inputFormat=${format} inputSignature=${inputSignature} inputBytes=${audio.size} durationMs=${safeDurationMs} primary=${this.openRouter.getSttModel()} fallback=${this.openRouter.getSttFallbackModel()} status=${status || 'unknown'}`,
      );
      throw new ServiceUnavailableException('Speech transcription is temporarily unavailable');
    }
  }

  private assertRateLimit(ownerUserId: string) {
    const now = Date.now();
    const recent = (this.attemptsByUser.get(ownerUserId) || []).filter(
      (attemptAt) => now - attemptAt < RATE_WINDOW_MS,
    );
    if (recent.length >= MAX_ATTEMPTS_PER_MINUTE) {
      throw new HttpException('Too many speaking attempts. Please wait a moment.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.attemptsByUser.set(ownerUserId, recent);
  }
}
