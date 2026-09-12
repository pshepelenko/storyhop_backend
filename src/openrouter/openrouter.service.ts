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
  sttModel: string;
  sttFallbackModel: string;
  readingAlignmentModel: string;
  readingAlignmentProviderOrder: string[];
  imageModel: string;
  imageAspectRatio: string;
  imageQuality: string;
  apiKey: string;
  frontendUrl: string;
  storyProviderOrder: string[];
  storyProviderSort: string;
  storyProviderAllowFallbacks: boolean;
  seasonProviderOrder: string[];
  seasonProviderSort: string;
  seasonProviderAllowFallbacks: boolean;
}

export interface OpenRouterTranscriptionResult {
  transcript: string;
  model: string;
  requestId: string | null;
  durationSeconds: number | null;
  costUsd: number | null;
}

export interface OpenRouterTimestampedWord {
  word: string;
  start: number;
  end: number;
}

export interface OpenRouterTimestampedTranscriptionResult extends OpenRouterTranscriptionResult {
  words: OpenRouterTimestampedWord[];
}

export interface OpenRouterImageGenerationResult {
  body: Buffer;
  contentType: string;
  requestId: string | null;
}

export interface JsonGenerationOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  reasoning?: { enabled?: boolean; effort?: string };
  providerOrder?: string[];
  providerAllowFallbacks?: boolean;
  providerSort?: string;
  timeoutMs?: number;
  jsonSchema?: OpenRouterJsonSchema;
  /** Used by the season framework pipeline to distinguish an empty upstream completion from malformed JSON. */
  throwOnEmptyContent?: boolean;
  suppressRawFailureLog?: boolean;
  onFailure?: (failure: OpenRouterJsonFailure) => Promise<void> | void;
  onCompletion?: (completion: OpenRouterJsonFailure) => Promise<void> | void;
}

export interface OpenRouterJsonSchema {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

export type OpenRouterJsonFailureKind = 'empty_content' | 'invalid_json' | 'request_error' | 'json_repair_error';

export interface OpenRouterJsonFailure {
  kind: OpenRouterJsonFailureKind;
  model: string;
  requestedProvider: Record<string, unknown> | undefined;
  actualProvider: string | null;
  responseId: string | null;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  rawResponse: Record<string, any> | null;
  content: string;
  reasoning: string;
  httpStatus: number | null;
  errorBody: unknown;
  durationMs: number;
  requestSystemPrompt?: string;
  requestUserPrompt?: string;
}

export class OpenRouterEmptyContentError extends Error {
  constructor(public readonly failure: OpenRouterJsonFailure) {
    super(`OpenRouter returned empty response for model ${failure.model}`);
    this.name = 'OpenRouterEmptyContentError';
  }
}

@Injectable()
export class OpenRouterService {
  private config: OpenRouterConfig;

  constructor(
    private readonly logger: FileLogger,
    private readonly prompts: PromptsService,
  ) {
    const chatModel = process.env.OPENROUTER_STORY_MODEL || 'deepseek/deepseek-v4-flash-0731:nitro';
    const seasonModel = process.env.OPENROUTER_SEASON_MODEL || 'deepseek/deepseek-v4-pro-0813';
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
      sttModel: process.env.OPENROUTER_STT_MODEL || 'mistralai/voxtral-small-24b-2507-stt',
      sttFallbackModel: process.env.OPENROUTER_STT_FALLBACK_MODEL || 'openai/gpt-transcribe',
      readingAlignmentModel: process.env.OPENROUTER_READING_ALIGNMENT_MODEL || 'openai/whisper-large-v3-turbo',
      readingAlignmentProviderOrder: this.parseProviderOrder(
        process.env.OPENROUTER_READING_ALIGNMENT_PROVIDER_ORDER || 'Groq',
        process.env.OPENROUTER_READING_ALIGNMENT_MODEL || 'openai/whisper-large-v3-turbo',
        'flash',
      ),
      imageModel: process.env.OPENROUTER_IMAGE_MODEL || 'openai/gpt-image-2',
      imageAspectRatio: process.env.OPENROUTER_IMAGE_ASPECT_RATIO || '3:2',
      imageQuality: process.env.OPENROUTER_IMAGE_QUALITY || 'low',
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
    maxTokens: number | undefined,
    reasoning: { enabled: false } | { effort: string },
    provider: Record<string, unknown> | undefined,
    jsonSchema: OpenRouterJsonSchema | undefined,
    timeoutMs: number,
  ) {
    const startedAt = Date.now();
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
          reasoning,
          ...(provider ? { provider } : {}),
          ...(jsonSchema ? {
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: jsonSchema.name,
                strict: jsonSchema.strict ?? true,
                schema: jsonSchema.schema,
              },
            },
          } : {}),
        },
        { headers: this.authHeaders(), timeout: timeoutMs },
      );
      (response as any).__storyHopDurationMs = Date.now() - startedAt;
      return response;
    } catch (error) {
      (error as any).__storyHopDurationMs = Date.now() - startedAt;
      throw error;
    }
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

  getSeasonReasoningEffort(): string {
    return this.config.seasonReasoningEffort;
  }

  getSttModel(): string {
    return this.config.sttModel;
  }

  getReadingAlignmentModel(): string {
    return this.config.readingAlignmentModel;
  }

  getSttFallbackModel(): string {
    return this.config.sttFallbackModel;
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
    const defaultProvider = isSeason
      ? this.buildSeasonProviderRouting()
      : this.buildStoryProviderRouting();
    const provider = options?.providerOrder !== undefined
      ? this.buildProviderRouting(
        options.providerOrder,
        options.providerAllowFallbacks ?? (isSeason
          ? this.config.seasonProviderAllowFallbacks
          : this.config.storyProviderAllowFallbacks),
        options.providerSort ?? (isSeason ? this.config.seasonProviderSort : this.config.storyProviderSort),
      )
      : defaultProvider;
    const defaultTimeoutMs = isSeason ? 300000 : 120000;

    try {
      const response = await this.requestJsonCompletion(
        model,
        systemPrompt,
        userPrompt,
        options?.temperature ?? 0.7,
        options?.maxTokens,
        reasoning,
        provider,
        options?.jsonSchema,
        options?.timeoutMs ?? defaultTimeoutMs,
      );

      return this.parseCompletionWithRepair(response, {
        profile,
        model,
        provider,
        timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
        throwOnEmptyContent: options?.throwOnEmptyContent,
        suppressRawFailureLog: options?.suppressRawFailureLog,
        onFailure: options?.onFailure,
        onCompletion: options?.onCompletion,
        systemPrompt,
        userPrompt,
      });
    } catch (error) {
      if (error instanceof OpenRouterEmptyContentError) {
        throw error;
      }
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
            options?.maxTokens,
            reasoning,
            undefined,
            options?.jsonSchema,
            options?.timeoutMs ?? defaultTimeoutMs,
          );
          return this.parseCompletionWithRepair(retryResponse, {
            profile,
            model,
            provider: undefined,
            timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
            throwOnEmptyContent: options?.throwOnEmptyContent,
            suppressRawFailureLog: options?.suppressRawFailureLog,
            onFailure: options?.onFailure,
            onCompletion: options?.onCompletion,
            systemPrompt,
            userPrompt,
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
                options?.maxTokens,
                reasoning,
                this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort),
                options?.jsonSchema,
                options?.timeoutMs ?? defaultTimeoutMs,
              );
              return this.parseCompletionWithRepair(fallbackResponse, {
                profile,
                model: this.config.seasonFallbackModel,
                provider: this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort),
                timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
                throwOnEmptyContent: options?.throwOnEmptyContent,
                suppressRawFailureLog: options?.suppressRawFailureLog,
                onFailure: options?.onFailure,
                onCompletion: options?.onCompletion,
                systemPrompt,
                userPrompt,
              });
            } catch (fallbackError) {
              if (!(fallbackError instanceof OpenRouterEmptyContentError)) {
                await this.notifyFailure(
                  options?.onFailure,
                  this.buildRequestFailure(
                    this.config.seasonFallbackModel,
                    this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort),
                    fallbackError,
                  ),
                );
              }
              this.logJsonGenerationError(
                `generateJson [${this.config.seasonFallbackModel}] fallback-model`,
                fallbackError,
                options?.suppressRawFailureLog,
              );
              throw fallbackError;
            }
          }

          if (!(retryError instanceof OpenRouterEmptyContentError)) {
            await this.notifyFailure(options?.onFailure, this.buildRequestFailure(model, undefined, retryError));
          }
          this.logJsonGenerationError(
            `generateJson [${model}] retry-without-provider`,
            retryError,
            options?.suppressRawFailureLog,
          );
          throw retryError;
        }
      }

      await this.notifyFailure(options?.onFailure, this.buildRequestFailure(model, provider, error));
      this.logJsonGenerationError(`generateJson [${model}]`, error, options?.suppressRawFailureLog);
      throw error;
    }
  }

  getImageModelLabel(): string {
    return this.config.imageModel;
  }

  async generateImage(prompt: string): Promise<OpenRouterImageGenerationResult> {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/images',
        {
          model: this.config.imageModel,
          prompt,
          aspect_ratio: this.config.imageAspectRatio,
          quality: this.config.imageQuality,
          background: 'opaque',
          n: 1,
        },
        { headers: this.authHeaders(), timeout: 180000 },
      );

      const encoded = response.data?.data?.[0]?.b64_json;
      if (typeof encoded !== 'string' || !encoded.trim()) {
        throw new Error('OpenRouter image response did not include b64_json');
      }

      const body = Buffer.from(encoded, 'base64');
      if (!body.length) {
        throw new Error('OpenRouter image response decoded to an empty buffer');
      }

      const contentType = String(
        response.data?.data?.[0]?.media_type || response.data?.data?.[0]?.mime_type || 'image/png',
      );
      if (!contentType.startsWith('image/')) {
        throw new Error(`OpenRouter image response returned unsupported content type: ${contentType}`);
      }

      const requestId = String(
        response.headers?.['x-request-id'] || response.headers?.['request-id'] || '',
      ).trim() || null;
      return { body, contentType, requestId };
    } catch (error) {
      this.logger.logOpenRouterError(`generateImage [${this.config.imageModel}]`, error);
      throw error;
    }
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

  async transcribeAudio(audio: Buffer, format: 'm4a' | 'mp3' | 'webm'): Promise<OpenRouterTranscriptionResult> {
    try {
      return await this.requestTranscription(this.config.sttModel, audio, format);
    } catch (primaryError) {
      this.logger.logOpenRouterError(`transcribeAudio [${this.config.sttModel}] primary`, primaryError);
      if (!this.shouldFallbackTranscription(primaryError)) {
        throw primaryError;
      }
      try {
        return await this.requestTranscription(this.config.sttFallbackModel, audio, format);
      } catch (fallbackError) {
        this.logger.logOpenRouterError(`transcribeAudio [${this.config.sttFallbackModel}] fallback`, fallbackError);
        throw fallbackError;
      }
    }
  }

  async transcribeReadingAlignment(audio: Buffer): Promise<OpenRouterTimestampedTranscriptionResult> {
    const model = this.config.readingAlignmentModel;
    const response = await axios.post(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      {
        model,
        input_audio: {
          data: audio.toString('base64'),
          format: 'mp3',
        },
        language: 'en',
        temperature: 0,
        // The transcription endpoint otherwise may return only its small
        // default token budget, which looks like a valid but truncated map.
        max_tokens: 1024,
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        provider: this.buildProviderRouting(
          this.config.readingAlignmentProviderOrder,
          false,
          '',
        ),
      },
      // Alignment is background-only: a little headroom avoids rejecting an
      // otherwise valid long chapter while the reader keeps its instant map.
      { headers: this.authHeaders(), timeout: 15000 },
    );

    const transcript = String(response.data?.text || '').trim();
    const words = Array.isArray(response.data?.words)
      ? response.data.words
          .map((word: any) => ({
            word: String(word?.word || ''),
            start: Number(word?.start),
            end: Number(word?.end),
          }))
          .filter((word: OpenRouterTimestampedWord) =>
            Boolean(word.word.trim()) && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start,
          )
      : [];
    if (!transcript || !words.length) {
      throw new Error('OpenRouter reading alignment response did not include word timestamps');
    }

    const requestId = String(
      response.headers?.['x-generation-id'] || response.headers?.['x-request-id'] || response.headers?.['request-id'] || '',
    ).trim() || null;
    const durationSeconds = Number(response.data?.usage?.seconds ?? response.data?.duration);
    const costUsd = Number(response.data?.usage?.cost);
    return {
      transcript,
      words,
      model,
      requestId,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      costUsd: Number.isFinite(costUsd) ? costUsd : null,
    };
  }

  private shouldFallbackTranscription(error: unknown): boolean {
    const status = Number((error as { response?: { status?: number } } | null)?.response?.status || 0);
    return !status || status === 429 || status >= 500;
  }

  private async requestTranscription(
    model: string,
    audio: Buffer,
    format: 'm4a' | 'mp3' | 'webm',
  ): Promise<OpenRouterTranscriptionResult> {
    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/audio/transcriptions',
        {
          model,
          input_audio: {
            data: audio.toString('base64'),
            format,
          },
          language: 'en',
          temperature: 0,
        },
        { headers: this.authHeaders(), timeout: 15000 },
      );

      const transcript = String(response.data?.text || '').trim();
      if (!transcript) {
        throw new Error('OpenRouter transcription response did not include text');
      }

      const requestId = String(
        response.headers?.['x-generation-id'] || response.headers?.['x-request-id'] || response.headers?.['request-id'] || '',
      ).trim() || null;
      const durationSeconds = Number(response.data?.usage?.seconds);
      const costUsd = Number(response.data?.usage?.cost);
      return {
        transcript,
        model,
        requestId,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        costUsd: Number.isFinite(costUsd) ? costUsd : null,
      };
    } catch (error) {
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
      this.config.sttModel,
      this.config.sttFallbackModel,
      this.config.readingAlignmentModel,
      this.config.imageModel,
    ].filter((model, index, list) => Boolean(model) && list.indexOf(model) === index);

    for (const model of modelsToCheck) {
      try {
        if (
          model === this.config.imageModel ||
          model === this.config.ttsModel ||
          model === this.config.sttModel ||
          model === this.config.sttFallbackModel ||
          model === this.config.readingAlignmentModel
        ) {
          await axios.get(
            `https://openrouter.ai/api/v1/models/${encodeURIComponent(model)}/endpoints`,
            { headers: this.authHeaders(), timeout: 15000 },
          );
          results.push({ model, available: true });
          continue;
        }
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

  private extractCompletion(response: any, model: string, provider: Record<string, unknown> | undefined, durationMs: number): OpenRouterJsonFailure {
    const message = response?.data?.choices?.[0]?.message || {};
    const content = message?.content;
    const raw = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part: any) => part?.text || part?.content || '').join('')
        : '';
    const reasoning = typeof message?.reasoning === 'string'
      ? message.reasoning
      : typeof message?.reasoning_content === 'string'
        ? message.reasoning_content
        : '';
    const actualProvider = response?.data?.provider || response?.headers?.['x-openrouter-provider'] || null;
    return {
      kind: raw.trim() ? 'invalid_json' : 'empty_content',
      model,
      requestedProvider: provider,
      actualProvider: actualProvider ? String(actualProvider) : null,
      responseId: response?.data?.id ? String(response.data.id) : null,
      finishReason: response?.data?.choices?.[0]?.finish_reason ? String(response.data.choices[0].finish_reason) : null,
      usage: response?.data?.usage && typeof response.data.usage === 'object' ? response.data.usage : null,
      rawResponse: response?.data && typeof response.data === 'object' ? response.data : null,
      content: raw,
      reasoning,
      httpStatus: Number(response?.status || 0) || null,
      errorBody: null,
      durationMs: Number(response?.__storyHopDurationMs || durationMs) || 0,
    };
  }

  private buildRequestFailure(model: string, provider: Record<string, unknown> | undefined, error: any): OpenRouterJsonFailure {
    return {
      kind: 'request_error',
      model,
      requestedProvider: provider,
      actualProvider: null,
      responseId: error?.response?.data?.id ? String(error.response.data.id) : null,
      finishReason: null,
      usage: error?.response?.data?.usage && typeof error.response.data.usage === 'object' ? error.response.data.usage : null,
      rawResponse: null,
      content: '',
      reasoning: '',
      httpStatus: Number(error?.response?.status || 0) || null,
      errorBody: error?.response?.data || error?.message || null,
      durationMs: Number(error?.__storyHopDurationMs || 0) || 0,
    };
  }

  private async notifyFailure(
    callback: JsonGenerationOptions['onFailure'],
    failure: OpenRouterJsonFailure,
  ) {
    if (!callback) return;
    try {
      await callback(failure);
    } catch (callbackError) {
      this.logger.warn(`[OpenRouter] diagnostic callback failed: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`);
    }
  }

  private async notifyCompletion(
    callback: JsonGenerationOptions['onCompletion'],
    completion: OpenRouterJsonFailure,
  ) {
    if (!callback) return;
    try {
      await callback(completion);
    } catch (callbackError) {
      this.logger.warn(`[OpenRouter] completion callback failed: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`);
    }
  }

  private logJsonGenerationError(context: string, error: any, suppressBody?: boolean) {
    if (!suppressBody) {
      this.logger.logOpenRouterError(context, error);
      return;
    }
    const status = error?.response?.status || 'N/A';
    const code = error?.code || error?.cause?.code || status;
    const message = String(error?.message || 'no message').slice(0, 500);
    this.logger.error(`[OpenRouter] ${context} failed | status=${status} code=${code} | ${message} | body=stored_in_encrypted_diagnostics`);
  }

  private async parseCompletionWithRepair(
    response: any,
    context: {
      profile: 'story' | 'season';
      model: string;
      provider: Record<string, unknown> | undefined;
      timeoutMs: number;
      throwOnEmptyContent?: boolean;
      suppressRawFailureLog?: boolean;
      onFailure?: JsonGenerationOptions['onFailure'];
      onCompletion?: JsonGenerationOptions['onCompletion'];
      systemPrompt: string;
      userPrompt: string;
    },
  ): Promise<Record<string, any>> {
    const failure = this.extractCompletion(response, context.model, context.provider, 0);
    failure.requestSystemPrompt = context.systemPrompt;
    failure.requestUserPrompt = context.userPrompt;
    await this.notifyCompletion(context.onCompletion, failure);
    if (!failure.content.trim() && context.throwOnEmptyContent) {
      await this.notifyFailure(context.onFailure, failure);
      throw new OpenRouterEmptyContentError(failure);
    }
    return this.parseJsonResponseWithRepair(failure.content, { ...context, completion: failure });
  }

  private async parseJsonResponseWithRepair(
    raw: string,
    context: {
      profile: 'story' | 'season';
      model: string;
      provider: Record<string, unknown> | undefined;
      timeoutMs: number;
      suppressRawFailureLog?: boolean;
      onFailure?: JsonGenerationOptions['onFailure'];
      completion?: OpenRouterJsonFailure;
    },
  ): Promise<Record<string, any>> {
    try {
      return this.parseJsonResponse(raw);
    } catch (parseError) {
      await this.notifyFailure(context.onFailure, {
        ...(context.completion || {}),
        kind: 'invalid_json', model: context.model, requestedProvider: context.provider,
        content: raw,
        errorBody: parseError instanceof Error ? parseError.message : String(parseError),
        actualProvider: context.completion?.actualProvider || null,
        responseId: context.completion?.responseId || null,
        finishReason: context.completion?.finishReason || null,
        usage: context.completion?.usage || null,
        rawResponse: context.completion?.rawResponse || null,
        reasoning: context.completion?.reasoning || '',
        httpStatus: context.completion?.httpStatus || null,
        durationMs: context.completion?.durationMs || 0,
      });
      if (context.suppressRawFailureLog) {
        this.logger.error(
          `[OpenRouter] generateJson [${context.model}] returned invalid JSON | parseError=${parseError instanceof Error ? parseError.message : String(parseError)} | raw=stored_in_encrypted_diagnostics`,
        );
      } else {
        this.logger.logInvalidLlmResponse(
          `generateJson [${context.model}]`,
          raw,
          parseError,
        );
      }
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
      let repairCompletion: OpenRouterJsonFailure | null = null;
      try {
        const repairStartedAt = Date.now();
        const repairResponse = await this.requestJsonCompletion(
          repairModel,
          system,
          user,
          0,
          undefined,
          { enabled: false },
          context.profile === 'season'
            ? this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort)
            : context.provider,
          undefined,
          context.timeoutMs,
        );
        (repairResponse as any).__storyHopDurationMs = Date.now() - repairStartedAt;
        repairCompletion = this.extractCompletion(
          repairResponse,
          repairModel,
          context.profile === 'season'
            ? this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort)
            : context.provider,
          0,
        );
        repairRaw = repairCompletion.content;
        return this.parseJsonResponse(repairRaw);
      } catch (repairError) {
        await this.notifyFailure(context.onFailure, {
          ...(repairCompletion || {}),
          kind: 'json_repair_error', model: repairModel,
          requestedProvider: context.profile === 'season'
            ? this.buildProviderRouting([], this.config.seasonProviderAllowFallbacks, this.config.seasonProviderSort)
            : context.provider,
          actualProvider: repairCompletion?.actualProvider || null,
          responseId: repairCompletion?.responseId || null,
          finishReason: repairCompletion?.finishReason || null,
          usage: repairCompletion?.usage || null,
          rawResponse: repairCompletion?.rawResponse || null,
          content: repairRaw, reasoning: repairCompletion?.reasoning || '',
          httpStatus: repairCompletion?.httpStatus || Number((repairError as any)?.response?.status || 0) || null,
          errorBody: repairError instanceof Error ? repairError.message : String(repairError),
          durationMs: repairCompletion?.durationMs || Number((repairError as any)?.__storyHopDurationMs || 0) || 0,
          requestSystemPrompt: system,
          requestUserPrompt: user,
        });
        if (repairRaw) {
          if (context.suppressRawFailureLog) {
            this.logger.error(
              `[OpenRouter] generateJson [${repairModel}] json-repair returned invalid JSON | raw=stored_in_encrypted_diagnostics`,
            );
          } else {
            this.logger.logInvalidLlmResponse(
              `generateJson [${repairModel}] json-repair`,
              repairRaw,
              repairError,
            );
          }
        }
        this.logger.logOpenRouterError(`generateJson [${repairModel}] json-repair`, repairError);
        throw parseError;
      }
    }
  }
}
