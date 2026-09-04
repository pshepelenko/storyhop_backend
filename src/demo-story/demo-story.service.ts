import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { StorageService } from '../storage/storage.service';
import { AudioMetadataService } from '../audio-metadata/audio-metadata.service';
import { ReadingAlignmentService } from '../reading-alignment/reading-alignment.service';
import { DemoStory } from './demo-story.entity';
import { DemoStoryNode } from './demo-story-node.entity';
import { DEMO_MEDIA_VERSION, DEMO_STORY_ID, DEMO_STORY_SLUG, demoStoryContent, demoStoryNodes } from './demo-story.content';

@Injectable()
export class DemoStoryService {
  constructor(
    @InjectRepository(DemoStory)
    private readonly demoStories: Repository<DemoStory>,
    @InjectRepository(DemoStoryNode)
    private readonly demoNodes: Repository<DemoStoryNode>,
    private readonly openRouter: OpenRouterService,
    private readonly storage: StorageService,
    private readonly audioMetadata: AudioMetadataService,
    private readonly readingAlignment: ReadingAlignmentService,
  ) {}

  async getDemoStory(slug = DEMO_STORY_SLUG) {
    await this.ensureTextSeed();
    const story = await this.demoStories.findOne({ where: { slug } });
    if (!story) {
      throw new Error(`Demo story not found: ${slug}`);
    }
    const nodes = await this.demoNodes.find({
      where: { demoStoryId: story.demoStoryId },
      order: { episodeNumber: 'ASC', nodeKey: 'ASC' },
    });

    return {
      ...story,
      startNodeKey: story.framework?.branching?.start || 'start',
      nodes: nodes.map((node) => ({
        ...node,
        highlightedVocabulary: Array.isArray(node.highlightedVocabulary)
          ? node.highlightedVocabulary
              .filter((item: any) => String(item?.term || '').trim() && String(item?.meaningInContext || '').trim())
              .map((item: any) => ({
                term: String(item.term).trim(),
                meaningInContext: String(item.meaningInContext).trim(),
              }))
          : [],
        imageUrl: this.normalizeStorageUrl(node.imageUrl),
        audioChunks: Array.isArray(node.audioChunks)
          ? node.audioChunks.map((chunk: any) => ({
              ...chunk,
              audioUrl: this.normalizeStorageUrl(chunk.audioUrl),
            }))
          : [],
      })),
    };
  }

  async seedTextContent() {
    return this.ensureTextSeed(true);
  }

  async seedMedia() {
    await this.ensureTextSeed();
    const story = await this.demoStories.findOne({ where: { slug: DEMO_STORY_SLUG } });
    if (!story) {
      throw new Error('Demo story text seed failed');
    }
    const nodes = await this.demoNodes.find({
      where: { demoStoryId: story.demoStoryId },
      order: { episodeNumber: 'ASC', nodeKey: 'ASC' },
    });

    const results = [];
    for (const node of nodes) {
      const nextAudioChunks = Array.isArray(node.audioChunks) ? [...node.audioChunks] : [];
      const audioById = new Map(nextAudioChunks.map((chunk: any) => [chunk.id, chunk]));

      const desiredAudio: Array<{
        id: string;
        type: string;
        text: string;
        choiceId?: string | null;
      }> = [
        { id: 'chapter', type: 'chapter', text: node.chapterText },
        ...(node.introOptionsPhrase ? [{ id: 'intro', type: 'intro', text: node.introOptionsPhrase }] : []),
        ...node.choices.map((choice: any) => ({
          id: `choice-${choice.id}`,
          type: 'choice',
          choiceId: choice.id,
          text: choice.text,
        })),
      ];

      for (const item of desiredAudio) {
        const existing = audioById.get(item.id);
        if (existing?.audioUrl) continue;
        const storageKey = `demo-story/${story.slug}/${DEMO_MEDIA_VERSION}/audio/${node.nodeKey}-${item.id}.mp3`;
        const audioBuffer = await this.openRouter.generateTts(item.text, undefined, 0.82);
        const normalized = this.audioMetadata.normalizeMp3(audioBuffer);
        const audioUrl = await this.storage.upload(storageKey, normalized.buffer, 'audio/mpeg');
        audioById.set(item.id, {
          id: item.id,
          type: item.type,
          choiceId: item.choiceId || null,
          text: item.text,
          status: 'ready',
          audioUrl,
          durationSeconds: normalized.durationSeconds,
        });
      }

      let imageUrl = node.imageUrl;
      if (!imageUrl) {
        const imageResult = await this.openRouter.generateImage(node.illustrationPrompt);
        const storageKey = `demo-story/${story.slug}/${DEMO_MEDIA_VERSION}/images/${node.nodeKey}.png`;
        imageUrl = await this.storage.upload(
          storageKey,
          imageResult.body,
          imageResult.contentType,
        );
      }

      node.imageUrl = imageUrl;
      node.audioChunks = Array.from(audioById.values());
      node.updatedAt = new Date();
      await this.demoNodes.save(node);

      results.push({
        nodeKey: node.nodeKey,
        imageReady: Boolean(node.imageUrl),
        audioReady: node.audioChunks.filter((chunk: any) => chunk.audioUrl).length,
      });
    }

    await this.demoStories.update(
      { demoStoryId: story.demoStoryId },
      { status: 'ready', updatedAt: new Date() },
    );

    return { status: 'ready', results };
  }

  /**
   * Attaches the reviewed demo assets that already exist in R2. It never calls
   * an AI provider and verifies every object before changing the database.
   */
  async importMediaSnapshot() {
    await this.ensureTextSeed();
    const story = await this.demoStories.findOne({ where: { slug: DEMO_STORY_SLUG } });
    if (!story) {
      throw new Error('Demo story text seed failed');
    }
    const nodes = await this.demoNodes.find({
      where: { demoStoryId: story.demoStoryId },
      order: { episodeNumber: 'ASC', nodeKey: 'ASC' },
    });

    const snapshot = nodes.map((node) => {
      const baseKey = `demo-story/${story.slug}/${DEMO_MEDIA_VERSION}`;
      const audioChunks = [
        {
          id: 'chapter',
          type: 'chapter',
          choiceId: null,
          text: node.chapterText,
          status: 'ready',
          audioKey: `${baseKey}/audio/${node.nodeKey}-chapter.mp3`,
        },
        ...(node.introOptionsPhrase
          ? [{
              id: 'intro',
              type: 'intro',
              choiceId: null,
              text: node.introOptionsPhrase,
              status: 'ready',
              audioKey: `${baseKey}/audio/${node.nodeKey}-intro.mp3`,
            }]
          : []),
        ...node.choices.map((choice: any) => ({
          id: `choice-${choice.id}`,
          type: 'choice',
          choiceId: choice.id,
          text: choice.text,
          status: 'ready',
          audioKey: `${baseKey}/audio/${node.nodeKey}-choice-${choice.id}.mp3`,
        })),
      ];
      return {
        node,
        imageKey: `${baseKey}/images/${node.nodeKey}.png`,
        audioChunks,
      };
    });

    const requiredKeys = snapshot.flatMap(({ imageKey, audioChunks }) => [
      imageKey,
      ...audioChunks.map((chunk) => chunk.audioKey),
    ]);
    const presence = await Promise.all(requiredKeys.map(async (key) => [key, await this.storage.exists(key)] as const));
    const missing = presence.filter(([, present]) => !present).map(([key]) => key);
    if (missing.length) {
      throw new Error(`Demo media snapshot is incomplete in R2: ${missing.join(', ')}`);
    }

    await this.demoNodes.manager.transaction(async (manager) => {
      for (const { node, imageKey, audioChunks } of snapshot) {
        await manager.update(
          DemoStoryNode,
          { nodeId: node.nodeId },
          {
            imageUrl: this.storage.getProxyUrl(imageKey),
            audioChunks: audioChunks.map(({ audioKey, ...chunk }) => ({
              ...chunk,
              audioUrl: this.storage.getProxyUrl(audioKey),
            })) as any,
            updatedAt: new Date(),
          },
        );
      }
      await manager.update(
        DemoStory,
        { demoStoryId: story.demoStoryId },
        { status: 'ready', updatedAt: new Date() },
      );
    });

    return {
      status: 'ready',
      importedNodes: snapshot.length,
      importedImages: snapshot.length,
      importedAudioChunks: requiredKeys.length - snapshot.length,
    };
  }

  /**
   * One-time, idempotent enrichment for reviewed demo MP3 files. It never
   * generates demo text, audio, or images.
   */
  async backfillReadingAlignments() {
    await this.ensureTextSeed();
    const story = await this.demoStories.findOne({ where: { slug: DEMO_STORY_SLUG } });
    if (!story) throw new Error('Demo story text seed failed');
    const nodes = await this.demoNodes.find({
      where: { demoStoryId: story.demoStoryId },
      order: { episodeNumber: 'ASC', nodeKey: 'ASC' },
    });

    const result = { scanned: 0, exact: 0, estimated: 0, skipped: 0 };
    for (const node of nodes) {
      let changed = false;
      const nextChunks = (node.audioChunks || []).map((chunk: any) => ({ ...chunk }));
      for (let index = 0; index < nextChunks.length; index += 1) {
        const chunk = nextChunks[index];
        if (chunk.type !== 'chapter' || !chunk.audioUrl || !chunk.text) continue;
        const key = this.storage.extractKeyFromUrl(chunk.audioUrl);
        if (!key) {
          result.skipped += 1;
          continue;
        }
        // Imported demo MP3s predate the header repair. Normalize bytes only
        // in memory for STT, without changing their R2 key or media content.
        const { body } = await this.storage.download(key);
        const normalized = this.audioMetadata.normalizeMp3(body);
        const durationSeconds = normalized.durationSeconds;
        if (durationSeconds <= 0) {
          result.skipped += 1;
          continue;
        }
        if (Number(chunk.durationSeconds || 0) !== durationSeconds) {
          nextChunks[index] = { ...chunk, durationSeconds };
          changed = true;
        }
        result.scanned += 1;
        const textHash = this.readingAlignment.textHash(chunk.text);
        const current = chunk.readingAlignment;
        if (current?.status === 'exact' && current.textHash === textHash && current.audioUrl === chunk.audioUrl) {
          result.skipped += 1;
          continue;
        }
        const estimated = this.readingAlignment.buildEstimated(chunk.text, chunk.audioUrl, durationSeconds);
        const alignment = await this.readingAlignment.createExact(
          chunk.text,
          chunk.audioUrl,
          durationSeconds,
          estimated,
          normalized.buffer,
        );
        nextChunks[index] = { ...nextChunks[index], readingAlignment: alignment };
        changed = true;
        if (alignment.status === 'exact') result.exact += 1;
        else result.estimated += 1;
      }
      if (changed) {
        node.audioChunks = nextChunks;
        node.updatedAt = new Date();
        await this.demoNodes.save(node);
      }
    }
    return result;
  }

  private async ensureTextSeed(force = false) {
    const existing = await this.demoStories.findOne({ where: { slug: DEMO_STORY_SLUG } });
    if (existing && !force) {
      return { status: 'exists', demoStoryId: existing.demoStoryId };
    }

    const now = new Date();
    await this.demoStories.save({
      demoStoryId: demoStoryContent.demoStoryId,
      slug: demoStoryContent.slug,
      title: demoStoryContent.title,
      scenario: demoStoryContent.scenario,
      framework: demoStoryContent.framework,
      status: existing?.status || 'text_seeded',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    for (const node of demoStoryNodes) {
      const existingNode = await this.demoNodes.findOne({
        where: { demoStoryId: DEMO_STORY_ID, nodeKey: node.nodeKey },
      });
      const nodePayload: Partial<DemoStoryNode> = {
        nodeId: node.nodeId,
        demoStoryId: DEMO_STORY_ID,
        nodeKey: node.nodeKey,
        episodeNumber: node.episodeNumber,
        title: node.title,
        chapterText: node.chapterText,
        introOptionsPhrase: node.introOptionsPhrase,
        highlightedVocabulary: node.highlightedVocabulary.map((item) => ({ ...item })),
        choices: node.choices.map((item) => ({ ...item })),
        illustrationPrompt: node.illustrationPrompt,
        imageUrl: existingNode?.imageUrl || null,
        audioChunks: existingNode?.audioChunks || [],
        isStart: node.nodeKey === demoStoryContent.framework.branching.start,
        isEnding: Boolean((node as any).isEnding),
        createdAt: existingNode?.createdAt || now,
        updatedAt: now,
      };
      await this.demoNodes.save(nodePayload);
    }

    return { status: existing ? 'updated' : 'created', demoStoryId: DEMO_STORY_ID };
  }

  private normalizeStorageUrl(url?: string | null) {
    if (!url) {
      return null;
    }
    if (url.startsWith('data:') || url.includes('/storage-proxy?')) {
      return url;
    }

    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const key = this.storage.extractKeyFromUrl(url);
    if (key) {
      return `${backendUrl}/storage-proxy?key=${encodeURIComponent(key)}`;
    }
    return null;
  }
}
