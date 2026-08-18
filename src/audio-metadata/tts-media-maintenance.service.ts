import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DemoStoryNode } from '../demo-story/demo-story-node.entity';
import { Episode } from '../seasons/entities/episode.entity';
import { PreparedEpisode } from '../seasons/entities/prepared-episode.entity';
import { StorageService } from '../storage/storage.service';
import { AudioMetadataService } from './audio-metadata.service';

type Scope = 'demo' | 'all';
type Summary = { scanned: number; updated: number; repairedFiles: number; skipped: number };

/** Explicit offline repair for legacy MP3s. Never runs during app startup or reading. */
@Injectable()
export class TtsMediaMaintenanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly audioMetadata: AudioMetadataService,
  ) {}

  async normalize(scope: Scope = 'demo'): Promise<Summary> {
    const summary: Summary = { scanned: 0, updated: 0, repairedFiles: 0, skipped: 0 };
    await this.normalizeDemo(summary);
    if (scope === 'all') {
      await this.normalizeEpisodes(summary);
      await this.normalizePreparedEpisodes(summary);
    }
    return summary;
  }

  private async normalizeDemo(summary: Summary) {
    const repository = this.dataSource.getRepository(DemoStoryNode);
    const nodes = await repository.find();
    for (const node of nodes) {
      const chunks = await this.normalizeChunks(node.audioChunks || [], summary);
      if (chunks.changed) {
        node.audioChunks = chunks.value;
        node.updatedAt = new Date();
        await repository.save(node);
        summary.updated += 1;
      }
    }
  }

  private async normalizeEpisodes(summary: Summary) {
    const repository = this.dataSource.getRepository(Episode);
    const episodes = await repository.find();
    for (const episode of episodes) {
      const chunks = await this.normalizeChunks(episode.audioChunks || [], summary);
      if (chunks.changed) {
        episode.audioChunks = chunks.value;
        episode.updatedAt = new Date();
        await repository.save(episode);
        summary.updated += 1;
      }
    }
  }

  private async normalizePreparedEpisodes(summary: Summary) {
    const repository = this.dataSource.getRepository(PreparedEpisode);
    const preparedEpisodes = await repository.find();
    for (const prepared of preparedEpisodes) {
      const source = Array.isArray(prepared.payload?.preparedAudioChunks)
        ? prepared.payload.preparedAudioChunks
        : [];
      const chunks = await this.normalizeChunks(source, summary);
      if (chunks.changed) {
        prepared.payload = { ...(prepared.payload || {}), preparedAudioChunks: chunks.value };
        prepared.updatedAt = new Date();
        await repository.save(prepared);
        summary.updated += 1;
      }
    }
  }

  private async normalizeChunks(chunks: Record<string, any>[], summary: Summary) {
    let changed = false;
    const value: Record<string, any>[] = [];
    for (const chunk of chunks) {
      if (!chunk?.audioUrl) {
        value.push(chunk);
        continue;
      }
      const key = this.storage.extractKeyFromUrl(String(chunk.audioUrl));
      if (!key) {
        summary.skipped += 1;
        value.push(chunk);
        continue;
      }
      summary.scanned += 1;
      const object = await this.storage.download(key);
      const normalized = this.audioMetadata.normalizeMp3(object.body);
      const normalizedKey = normalized.changed
        ? key.replace(/\.mp3$/i, '.normalized-v1.mp3')
        : key;
      if (normalized.changed && !(await this.storage.exists(normalizedKey))) {
        await this.storage.upload(normalizedKey, normalized.buffer, 'audio/mpeg');
        summary.repairedFiles += 1;
      }
      const next = {
        ...chunk,
        audioUrl: this.storage.getProxyUrl(normalizedKey),
        durationSeconds: normalized.durationSeconds,
      };
      if (
        next.audioUrl !== chunk.audioUrl ||
        Number(chunk.durationSeconds || 0) !== normalized.durationSeconds
      ) {
        changed = true;
      }
      value.push(next);
    }
    return { value, changed };
  }
}
