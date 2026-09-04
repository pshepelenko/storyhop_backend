import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { FileLogger } from '../logging/file-logger.service';
import { OpenRouterService, OpenRouterTimestampedWord } from '../openrouter/openrouter.service';
import { StorageService } from '../storage/storage.service';

export type ReadingAlignmentRange = {
  start: number;
  end: number;
  startSeconds: number;
  endSeconds: number;
};

export type ReadingAlignment = {
  version: 1;
  textHash: string;
  audioUrl: string;
  durationSeconds: number;
  status: 'estimated' | 'exact' | 'failed';
  estimatedRanges: ReadingAlignmentRange[];
  exactRanges?: ReadingAlignmentRange[];
  model?: string;
  requestId?: string | null;
  costUsd?: number | null;
  coverage?: number;
  errorCode?: string;
  updatedAt: string;
};

type CanonicalWord = { value: string; start: number; end: number };

const WORD_PATTERN = /[a-z]+(?:['’][a-z]+)?/gi;
const MIN_COVERAGE = 0.92;

function normalizeWord(value: string) {
  return (String(value).toLowerCase().match(WORD_PATTERN) || []).join('').replace(/’/g, "'");
}

function canonicalWords(text: string): CanonicalWord[] {
  const words: CanonicalWord[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(WORD_PATTERN.source, 'gi');
  while ((match = regex.exec(text)) !== null) {
    words.push({ value: normalizeWord(match[0]), start: match.index, end: regex.lastIndex });
  }
  return words;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

@Injectable()
export class ReadingAlignmentService {
  constructor(
    private readonly openRouter: OpenRouterService,
    private readonly storage: StorageService,
    private readonly logger: FileLogger,
  ) {}

  isEnabled() {
    return process.env.READING_ALIGNMENT_ENABLED !== 'false';
  }

  textHash(text: string) {
    return createHash('sha256').update(String(text || '').trim()).digest('hex').slice(0, 16);
  }

  buildEstimated(text: string, audioUrl: string, durationSeconds: number): ReadingAlignment {
    const words = canonicalWords(text);
    const safeDuration = Math.max(0, Number(durationSeconds) || 0);
    const groups: CanonicalWord[][] = [];
    let group: CanonicalWord[] = [];

    for (const word of words) {
      group.push(word);
      const between = text.slice(word.end, Math.min(text.length, word.end + 3));
      const endsSentence = /[.!?]/.test(between);
      if (group.length >= 6 || (group.length >= 3 && endsSentence)) {
        groups.push(group);
        group = [];
      }
    }
    if (group.length) groups.push(group);

    const weights = groups.map((item) => {
      const last = item[item.length - 1];
      const punctuation = /[,;:]/.test(text.slice(last.end, last.end + 2)) ? 2 : /[.!?]/.test(text.slice(last.end, last.end + 2)) ? 4 : 0;
      return item.reduce((sum, word) => sum + Math.max(1, word.end - word.start), 0) + punctuation;
    });
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
    let cursor = 0;
    const estimatedRanges = groups.map((item, index) => {
      const startSeconds = cursor;
      cursor += safeDuration * (weights[index] / totalWeight);
      return {
        start: item[0].start,
        end: item[item.length - 1].end,
        startSeconds,
        endSeconds: index === groups.length - 1 ? safeDuration : cursor,
      };
    });

    return {
      version: 1,
      textHash: this.textHash(text),
      audioUrl,
      durationSeconds: safeDuration,
      status: 'estimated',
      estimatedRanges,
      updatedAt: new Date().toISOString(),
    };
  }

  async createExact(
    text: string,
    audioUrl: string,
    durationSeconds: number,
    estimated: ReadingAlignment,
    normalizedAudio?: Buffer,
  ) {
    const startedAt = Date.now();
    try {
      let audio = normalizedAudio;
      if (!audio) {
        const key = this.storage.extractKeyFromUrl(audioUrl);
        if (!key) {
          return this.failed(estimated, 'audio_key_missing');
        }
        audio = (await this.storage.download(key)).body;
      }
      const transcription = await this.openRouter.transcribeReadingAlignment(audio);
      const exactRanges = this.alignWords(text, transcription.words, durationSeconds);
      const expectedCount = canonicalWords(text).length;
      const coverage = expectedCount ? exactRanges.length / expectedCount : 0;
      if (coverage < MIN_COVERAGE) {
        return this.failed(estimated, 'coverage_below_threshold', coverage);
      }

      this.logger.log(
        `[ReadingAlignment] ready model=${transcription.model} requestId=${transcription.requestId || 'none'} latencyMs=${Date.now() - startedAt} costUsd=${transcription.costUsd ?? 'none'} coverage=${coverage.toFixed(3)} audioSeconds=${durationSeconds}`,
      );
      return {
        ...estimated,
        status: 'exact' as const,
        exactRanges,
        model: transcription.model,
        requestId: transcription.requestId,
        costUsd: transcription.costUsd,
        coverage,
        updatedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      const code = String(error?.response?.status || error?.code || error?.message || 'unknown')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 80);
      this.logger.logOpenRouterError('ReadingAlignment', error);
      return this.failed(estimated, code);
    }
  }

  private failed(estimated: ReadingAlignment, errorCode: string, coverage?: number): ReadingAlignment {
    return {
      ...estimated,
      status: 'failed',
      ...(coverage === undefined ? {} : { coverage }),
      errorCode,
      updatedAt: new Date().toISOString(),
    };
  }

  private alignWords(text: string, timedWords: OpenRouterTimestampedWord[], durationSeconds: number) {
    const expected = canonicalWords(text);
    const actual = timedWords
      .map((word) => ({ ...word, value: normalizeWord(word.word) }))
      .filter((word) => word.value);
    const rows = expected.length + 1;
    const columns = actual.length + 1;
    const matrix = Array.from({ length: rows }, () => new Uint16Array(columns));

    for (let left = 1; left < rows; left += 1) {
      for (let right = 1; right < columns; right += 1) {
        matrix[left][right] = expected[left - 1].value === actual[right - 1].value
          ? matrix[left - 1][right - 1] + 1
          : Math.max(matrix[left - 1][right], matrix[left][right - 1]);
      }
    }

    const pairs: Array<[number, number]> = [];
    let left = expected.length;
    let right = actual.length;
    while (left > 0 && right > 0) {
      if (expected[left - 1].value === actual[right - 1].value) {
        pairs.push([left - 1, right - 1]);
        left -= 1;
        right -= 1;
      } else if (matrix[left - 1][right] >= matrix[left][right - 1]) {
        left -= 1;
      } else {
        right -= 1;
      }
    }

    return pairs.reverse().map(([expectedIndex, actualIndex]) => ({
      start: expected[expectedIndex].start,
      end: expected[expectedIndex].end,
      startSeconds: clamp(actual[actualIndex].start, 0, durationSeconds),
      endSeconds: clamp(actual[actualIndex].end, 0, durationSeconds),
    })).filter((range) => range.endSeconds > range.startSeconds);
  }
}
