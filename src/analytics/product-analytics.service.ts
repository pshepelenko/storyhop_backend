import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { FileLogger } from '../logging/file-logger.service';

@Injectable()
export class ProductAnalyticsService {
  private readonly token = process.env.POSTHOG_PROJECT_TOKEN || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || '';
  private readonly host = (process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/$/, '');

  constructor(private readonly logger: FileLogger) {}

  async capture(event: string, distinctId: string | null | undefined, properties: Record<string, unknown>) {
    if (!this.token || !distinctId) return;
    try {
      await axios.post(`${this.host}/capture/`, {
        api_key: this.token,
        event,
        properties: { distinct_id: distinctId, ...properties },
      }, { timeout: 5000 });
    } catch (error) {
      this.logger.warn(`[PostHog] capture failed event=${event} status=${error?.response?.status || 'N/A'}`);
    }
  }
}
