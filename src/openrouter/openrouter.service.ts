import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { FileLogger } from '../logging/file-logger.service';
import { PromptsService } from '../prompts/prompts.service';

export interface OpenRouterConfig {
  chatModel: string;
  seasonModel: string;
  seasonFallbackModel: string;
  seasonReasoningEffort: string;
  ttsModel: string;
  ttsVoice: string;
  imageModel: string;
  apiKey: string;
  frontendUrl: string;
  storyProviderOrder: string[];
  storyProviderSort: string;
  storyProviderAllowFallbacks: boolean;
  seasonProviderOrder: string[];
  seasonProviderSort: string;
  seasonProviderAllowFallbacks: boolean;
}

export interface JsonGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  reasoning?: { enabled?: boolean; effort?: string };
  providerOrder?: string[];
  providerAllowFallbacks?: boolean;
  timeoutMs?: number;
}

@Injectable()
export class OpenRouterService {
  private config: OpenRouterConfig;

  constructor(
    private readonly logger: FileLogger,
    private readonly prompts: PromptsService,
  ) {
    const chatModel = process.env.OPENROUTER_STORY_MODEL || 'deepseek/deepseek-v4-flash';
    const seasonModel = process.env.OPENROUTER_SEASON_MODEL || 'deepseek/deepseek-v4-pro';
    const storyProviderOrder = this.parseProviderOrder(
      process.env.OPENROUTER_STORY_PROVIDER_ORDER,
      chatModel,
      'flash',
    );
    const seasonProviderOrder = this.parseProviderOrder(
      process.env.OPENROUTER_SEASON_PROVIDER_ORDER,
      seasonModel,
      'season',
    );

    this.config = {
      chatModel,
      seasonModel,
      seasonFallbackModel: process.env.OPENROUTER_SEASON_FALLBACK_MODEL || 'xiaomi/mimo-v2.5-pro',
      seasonReasoningEffort: process.env.OPENROUTER_SEASON_REASONING || 'medium',
      ttsModel: process.env.OPENROUTER_TTS_MODEL || 'hexgrad/kokoro-82m',
      ttsVoice: process.env.OPENROUTER_TTS_VOICE || 'bm_lewis',
      imageModel: process.env.OPENROUTER_IMAGE_MODEL || 'black-forest-labs/flux.2-klein-4b',
      apiKey: process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '',
      frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
      storyProviderOrder,
      storyProviderSort: process.env.OPENROUTER_STORY_PROVIDER_SORT || 'throughput',
      storyProviderAllowFallbacks: process.env.OPENROUTER_STORY_PROVIDER_ALLOW_FALLBACKS !== 'false',
      seasonProviderOrder,
      seasonProviderSort: process.env.OPENROUTER_SEASON_PROVIDER_SORT || 'throughput',
      seasonProviderAllowFallbacks: process.env.OPENROUTER_SEASON_PROVIDER_ALLOW_FALLBACKS !== 'false',
    };
  }

  private parseProviderOrder(
    rawOrder: string | undefined,
    _model: string,
    _profile: 'flash' | 'season',
  ): string[] {
    if (rawOrder !== undefined) {
      return rawOrder
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  private buildProviderRouting(
    providerOrder: string[],
    allowFallbacks: boolean,
    sort: string,
  ): Record<string, unknown> | undefined {
    if (!providerOrder.length && !sort) {
      return undefined;
    }

    return {
      ...(providerOrder.length ? { order: providerOrder } : {}),
      allow_fallbacks: allowFallbacks,
      ...(sort ? { sort } : {}),
    };
  }

  private buildStoryProviderRouting(): Record<string, unknown> | undefined {
    return this.buildProviderRouting(
      this.config.storyProviderOrder,
      this.config.storyProviderAllowFallbacks,
      this.config.storyProviderSort,
    );
  }

  private buildSeasonProviderRouting(): Record<string, unknown> | undefined {
    return this.buildProviderRouting(
      this.config.seasonProviderOrder,
      this.config.seasonProviderAllowFallbacks,
      this.config.seasonProviderSort,
    );
  }

  private shouldRetryWithoutProvider(error: any): boolean {
    const status = error?.response?.status;
    const message = String(error?.response?.data?.error?.message || error?.message || '');
    return status === 404 && message.includes('No endpoints found');
  }

  private async requestJsonCompletion(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    maxTokens: number,
    reasoning: { enabled: false } | { effort: string },
    provider: Record<string, unknown> | undefined,
    timeoutMs: number,
  ) {
    return axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
        reasoning,
        ...(provider ? { provider } : {}),
      },
      { headers: this.authHeaders(), timeout: timeoutMs },
    );
  }

  private buildReasoning(effort: string): { enabled: false } | { effort: string } {
    const normalized = effort.trim().toLowerCase();
    if (!normalized || normalized === 'off' || normalized === 'false' || normalized === 'none') {
      return { enabled: false };
    }

    return { effort: normalized };
  }

  private normalizeRequestedReasoning(
    reasoning?: { enabled?: boolean; effort?: string },
  ): { enabled: false } | { effort: string } | undefined {
    if (!reasoning) {
      return undefined;
    }

    if (reasoning.enabled === false) {
      return { enabled: false };
    }

    if (typeof reasoning.effort === 'string' && reasoning.effort.trim()) {
      return { effort: reasoning.effort.trim().toLowerCase() };
    }

    return undefined;
  }

  getChatModel(): string {
    return this.config.chatModel;
  }

  getSeasonModel(): string {
    return this.config.seasonModel;
  }

  getSeasonFallbackModel(): string {
    return this.config.seasonFallbackModel;
  }

  getTtsModel(): string {
    return this.config.ttsModel;
  }

  getTtsVoice(): string {
    return this.config.ttsVoice;
  }

  getImageModel(): string {
    return this.config.imageModel;
  }

  private ensureApiKey(): string {
    if (!this.config.apiKey) {
      throw new Error('OPEN_ROUTER_API_KEY is not configured');
    }
    return this.config.apiKey;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.ensureApiKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.config.frontendUrl,
      'X-Title': 'StoryHop',
    };
  }

  async generateJson(
    systemPrompt: string,
    userPrompt: string,
    options?: JsonGenerationOptions,
  ): Promise<Record<string, any>> {
    return this.generateJsonWithProfile('story', systemPrompt, userPrompt, options);
  }

  async generateSeasonJson(
    systemPrompt: string,
    userPrompt: string,
    options?: JsonGenerationOptions,
  ): Promise<Record<string, any>> {
    return this.generateJsonWithProfile('season', systemPrompt, userPrompt, {
      maxTokens: 8000,
      timeoutMs: 300000,
      ...options,
    });
  }

  private async generateJsonWithProfile(
    profile: 'story' | 'season',
    systemPrompt: string,
    userPrompt: string,
    options?: JsonGenerationOptions,
  ): Promise<Record<string, any>> {
    const isSeason = profile === 'season';
    const model = options?.model || (isSeason ? this.config.seasonModel : this.config.chatModel);
    const reasoning = this.normalizeRequestedReasoning(options?.reasoning)
      || (isSeason
        ? this.buildReasoning(this.config.seasonReasoningEffort)
        : { enabled: false });
    const provider = isSeason
      ? this.buildSeasonProviderRouting()
      : this.buildStoryProviderRouting();
    const defaultMaxTokens = isSeason ? 8000 : 2500;
    const defaultTimeoutMs = isSeason ? 300000 : 120000;

    try {
      const response = await this.requestJsonCompletion(
        model,
        systemPrompt,
        userPrompt,
        options?.temperature ?? 0.7,
        options?.maxTokens ?? defaultMaxTokens,
        reasoning,
        provider,
        options?.timeoutMs ?? defaultTimeoutMs,
      );

      const content = response.data?.choices?.[0]?.message?.content;
      const raw = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part: any) => part?.text || part?.content || '').join('')
          : '';

      return this.parseJsonResponseWithRepair(raw, {
        profile,
        model,
        provider,
        timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
      });
    } catch (error) {
      if (isSeason && provider && this.shouldRetryWithoutProvider(error)) {
        this.logger.warn(
          `[OpenRouter] generateJson [${model}] returned "No endpoints found" with provider routing; retrying without provider routing`,
        );

        try {
          const retryResponse = await this.requestJsonCompletion(
            model,
            systemPrompt,
            userPrompt,
            options?.temperature ?? 0.7,
            options?.maxTokens ?? defaultMaxTokens,
            reasoning,
            undefined,
            options?.timeoutMs ?? defaultTimeoutMs,
          );
          const retryContent = retryResponse.data?.choices?.[0]?.message?.content;
          const retryRaw = typeof retryContent === 'string'
            ? retryContent
            : Array.isArray(retryContent)
              ? retryContent.map((part: any) => part?.text || part?.content || '').join('')
              : '';

          return this.parseJsonResponseWithRepair(retryRaw, {
            profile,
            model,
            provider: undefined,
            timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
          });
        } catch (retryError) {
          if (
            this.config.seasonFallbackModel
            && this.config.seasonFallbackModel !== model
            && this.shouldRetryWithoutProvider(retryError)
          ) {
            this.logger.warn(
              `[OpenRouter] generateJson [${model}] still has no endpoints; retrying with fallback model ${this.config.seasonFallbackModel}`,
            );

            try {
              const fallbackResponse = await this.requestJsonCompletion(
                this.config.seasonFallbackModel,
                systemPrompt,
                userPrompt,
                options?.temperature ?? 0.7,
                options?.maxTokens ?? defaultMaxTokens,
                reasoning,
                this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort),
                options?.timeoutMs ?? defaultTimeoutMs,
              );
              const fallbackContent = fallbackResponse.data?.choices?.[0]?.message?.content;
              const fallbackRaw = typeof fallbackContent === 'string'
                ? fallbackContent
                : Array.isArray(fallbackContent)
                  ? fallbackContent.map((part: any) => part?.text || part?.content || '').join('')
                  : '';

              return this.parseJsonResponseWithRepair(fallbackRaw, {
                profile,
                model: this.config.seasonFallbackModel,
                provider: this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort),
                timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
              });
            } catch (fallbackError) {
              this.logger.logOpenRouterError(
                `generateJson [${this.config.seasonFallbackModel}] fallback-model`,
                fallbackError,
              );
              throw fallbackError;
            }
          }

          this.logger.logOpenRouterError(`generateJson [${model}] retry-without-provider`, retryError);
          throw retryError;
        }
      }

      this.logger.logOpenRouterError(`generateJson [${model}]`, error);
      throw error;
    }
  }

  async generateImage(prompt: string): Promise<{ url: string } | null> {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.config.imageModel,
          messages: [{ role: 'user', content: prompt }],
          modalities: ['image'],
        },
        { headers: this.authHeaders(), timeout: 120000 },
      );

      const url = this.extractImageUrl(response.data);
      if (!url) {
        this.logger.error(`[OpenRouter] generateImage returned empty URL, response: ${JSON.stringify(response.data).slice(0, 500)}`);
        return null;
      }
      return { url };
    } catch (error) {
      this.logger.logOpenRouterError(`generateImage [${this.config.imageModel}]`, error);
      throw error;
    }
  }

  private extractImageUrl(data: any): string | null {
    const message = data?.choices?.[0]?.message;
    const directUrl = message?.images?.[0]?.image_url?.url || message?.image_url?.url;
    if (directUrl) return directUrl;

    const content = Array.isArray(message?.content) ? message.content : [];
    const imagePart = content.find((part: any) => part?.image_url?.url || part?.url || part?.type === 'image_url');
    return imagePart?.image_url?.url || imagePart?.url || data?.url || null;
  }

  async generateTts(text: string, voice?: string, speed?: number): Promise<Buffer> {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/audio/speech',
        {
          input: text.replace(/\s+/g, ' ').trim(),
          model: this.config.ttsModel,
          voice: voice || this.config.ttsVoice,
          response_format: 'mp3',
          speed: speed ?? 0.8,
        },
        {
          headers: {
            Authorization: `Bearer ${this.ensureApiKey()}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 120000,
        },
      );

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.logOpenRouterError(`generateTts [${this.config.ttsModel}]`, error);
      throw error;
    }
  }

  async checkModelsHealth(): Promise<{ model: string; available: boolean; error?: string }[]> {
    const results: { model: string; available: boolean; error?: string }[] = [];

    const modelsToCheck = [
      this.config.chatModel,
      this.config.seasonModel,
      this.config.seasonFallbackModel,
      this.config.ttsModel,
      this.config.imageModel,
    ].filter((model, index, list) => Boolean(model) && list.indexOf(model) === index);

    for (const model of modelsToCheck) {
      try {
        const provider = model === this.config.chatModel
          ? this.buildStoryProviderRouting()
          : model === this.config.seasonModel
            ? this.buildSeasonProviderRouting()
            : undefined;
        await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            ...(provider ? { provider } : {}),
          },
          { headers: this.authHeaders(), timeout: 15000 },
        );
        results.push({ model, available: true });
      } catch (error: any) {
        const status = error?.response?.status || error?.code || 'unknown';
        const msg = error?.message || 'no message';
        this.logger.logOpenRouterUnavailable(model, 1, error);
        results.push({ model, available: false, error: `${status}: ${msg}` });
      }
    }

    return results;
  }

  private parseJsonResponse(raw: string): Record<string, any> {
    const trimmed = raw.trim();
    const fenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');

    try {
      return JSON.parse(fenced);
    } catch {
      const objectJson = this.extractFirstJsonObject(fenced);
      if (!objectJson) {
        throw new Error('Model returned invalid JSON');
      }
      return JSON.parse(objectJson);
    }
  }

  private extractFirstJsonObject(raw: string): string | null {
    const start = raw.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) return raw.slice(start, index + 1);
      }
    }

    return null;
  }

  private async parseJsonResponseWithRepair(
    raw: string,
    context: {
      profile: 'story' | 'season';
      model: string;
      provider: Record<string, unknown> | undefined;
      timeoutMs: number;
    },
  ): Promise<Record<string, any>> {
    try {
      return this.parseJsonResponse(raw);
    } catch (parseError) {
      this.logger.logInvalidLlmResponse(
        `generateJson [${context.model}]`,
        raw,
        parseError,
      );
      const repairModel = context.profile === 'season'
        ? this.config.seasonFallbackModel
        : this.config.chatModel;
      const { system, user } = this.prompts.buildPrompt('json-repair', {
        targetSchemaJson: 'A single JSON object with exactly the fields requested by the original task.',
        invalidModelOutput: raw.slice(0, 30000),
      });
      this.logger.warn(
        `[OpenRouter] Invalid JSON from ${context.model}; requesting JSON repair with ${repairModel}`,
      );

      let repairRaw = '';
      try {
        const repairResponse = await this.requestJsonCompletion(
          repairModel,
          system,
          user,
          0,
          4000,
          { enabled: false },
          context.profile === 'season'
            ? this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort)
            : context.provider,
          context.timeoutMs,
        );
        const repairContent = repairResponse.data?.choices?.[0]?.message?.content;
        repairRaw = typeof repairContent === 'string'
          ? repairContent
          : Array.isArray(repairContent)
            ? repairContent.map((part: any) => part?.text || part?.content || '').join('')
            : '';
        return this.parseJsonResponse(repairRaw);
      } catch (repairError) {
        if (repairRaw) {
          this.logger.logInvalidLlmResponse(
            `generateJson [${repairModel}] json-repair`,
            repairRaw,
            repairError,
          );
        }
        this.logger.logOpenRouterError(`generateJson [${repairModel}] json-repair`, repairError);
        throw parseError;
      }
    }
  }
}
