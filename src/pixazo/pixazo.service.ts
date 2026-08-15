import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { FileLogger } from '../logging/file-logger.service';

export interface PixazoImageConfig {
  apiKey: string;
  imageSize: string;
  imageQuality: string;
  pollTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface PixazoImageGenerationResult {
  url: string;
  requestId?: string;
  payload?: Record<string, any>;
}

export interface PixazoRecoveryResult {
  status: 'completed' | 'pending' | 'failed' | 'not_found';
  url?: string;
  requestId: string;
  payload?: Record<string, any>;
}

@Injectable()
export class PixazoService {
  private readonly config: PixazoImageConfig;
  private readonly textToImageUrl = 'https://gateway.pixazo.ai/gpt-image-2/v1/text-to-image';
  private readonly statusUrlBase = 'https://gateway.pixazo.ai/v2/requests/status';

  constructor(private readonly logger: FileLogger) {
    this.config = {
      apiKey: process.env.PIXAZO_API_KEY || '',
      imageSize: process.env.PIXAZO_IMAGE_SIZE || '1536x1024',
      imageQuality: process.env.PIXAZO_IMAGE_QUALITY || 'low',
      pollTimeoutMs: Number(process.env.PIXAZO_POLL_TIMEOUT_MS || 600000),
      requestTimeoutMs: Number(process.env.PIXAZO_REQUEST_TIMEOUT_MS || 180000),
    };
  }

  getImageModelLabel(): string {
    return `gpt-image-2/${this.config.imageSize}/${this.config.imageQuality}`;
  }

  private ensureApiKey(): string {
    if (!this.config.apiKey) {
      throw new Error('PIXAZO_API_KEY is not configured');
    }
    return this.config.apiKey;
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Ocp-Apim-Subscription-Key': this.ensureApiKey(),
    };
  }

  async generateImage(prompt: string): Promise<PixazoImageGenerationResult | null> {
    try {
      const response = await axios.post(
        this.textToImageUrl,
        {
          prompt,
          size: this.config.imageSize,
          quality: this.config.imageQuality,
        },
        {
          headers: this.authHeaders(),
          timeout: this.config.requestTimeoutMs,
        },
      );

      let payload = response.data;
      const requestId = payload?.request_id;
      if (requestId && !this.extractImageUrl(payload)) {
        payload = await this.pollStatus(requestId);
      }

      const url = this.extractImageUrl(payload);
      if (!url) {
        if (this.isModerationPayload(payload)) {
          const moderationError = new Error(this.extractModerationMessage(payload));
          throw Object.assign(moderationError, { response: { data: payload } });
        }

        this.logger.error(
          `[Pixazo] generateImage returned empty URL, response: ${JSON.stringify(payload).slice(0, 500)}`,
        );
        return null;
      }

      return { url, requestId, payload };
    } catch (error) {
      this.logger.logPixazoError(`generateImage [${this.getImageModelLabel()}]`, error);
      throw error;
    }
  }

  async recoverImage(requestId: string): Promise<PixazoRecoveryResult> {
    try {
      const payload = await this.fetchStatus(requestId);
      const status = String(payload?.status || '').toUpperCase();
      if (status === 'COMPLETED') {
        const url = this.extractImageUrl(payload);
        if (url) {
          return {
            status: 'completed',
            url,
            requestId,
            payload,
          };
        }
      }

      if (status === 'FAILED' || status === 'ERROR') {
        return {
          status: 'failed',
          requestId,
          payload,
        };
      }

      return {
        status: 'pending',
        requestId,
        payload,
      };
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return {
          status: 'not_found',
          requestId,
        };
      }
      throw error;
    }
  }

  private async pollStatus(requestId: string): Promise<Record<string, any>> {
    const started = Date.now();
    while (Date.now() - started < this.config.pollTimeoutMs) {
      const payload = await this.fetchStatus(requestId);
      const status = payload?.status;
      if (status === 'COMPLETED') {
        return payload;
      }
      if (status === 'FAILED' || status === 'ERROR') {
        const errorPayload = payload || {};
        const moderationError = this.isModerationPayload(errorPayload)
          ? new Error(this.extractModerationMessage(errorPayload))
          : new Error(this.extractModerationMessage(errorPayload) || `Pixazo job ${status}`);
        throw Object.assign(moderationError, {
          response: { data: errorPayload },
          pixazoRequestId: requestId,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw Object.assign(new Error('Pixazo image generation poll timeout'), {
      pixazoRequestId: requestId,
    });
  }

  private async fetchStatus(requestId: string): Promise<Record<string, any>> {
    const response = await axios.get(`${this.statusUrlBase}/${requestId}`, {
      headers: this.authHeaders(),
      timeout: this.config.requestTimeoutMs,
    });
    return response.data || {};
  }

  private extractImageUrl(payload: any): string | null {
    if (!payload) return null;
    if (typeof payload.output === 'string') return payload.output;
    if (typeof payload.image_url === 'string') return payload.image_url;
    if (typeof payload.imageUrl === 'string') return payload.imageUrl;
    if (typeof payload.url === 'string') return payload.url;

    const media = payload.output?.media_url;
    if (Array.isArray(media) && media[0]) return media[0];
    if (Array.isArray(payload.image_urls) && payload.image_urls[0]) return payload.image_urls[0];
    if (Array.isArray(payload.images) && payload.images[0]) return payload.images[0];

    return null;
  }

  private isModerationPayload(payload: any): boolean {
    return /Protected Content|Request Moderated|moderation_blocked|image_generation_user_error|rejected by the safety system|content policy|safety system|moderation/i.test(
      this.extractModerationMessage(payload),
    );
  }

  private extractModerationMessage(payload: any): string {
    if (!payload) {
      return '';
    }
    if (typeof payload === 'string') {
      return payload;
    }
    if (typeof payload.error === 'string') {
      return payload.error;
    }
    if (payload.error && typeof payload.error === 'object') {
      return JSON.stringify(payload.error);
    }
    if (typeof payload.message === 'string') {
      return payload.message;
    }
    return JSON.stringify(payload);
  }
}
