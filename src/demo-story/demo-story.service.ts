import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { PixazoService } from '../pixazo/pixazo.service';
import { StorageService } from '../storage/storage.service';
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
    private readonly pixazo: PixazoService,
    private readonly storage: StorageService,
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
        const audioUrl = await this.storage.upload(storageKey, audioBuffer, 'audio/mpeg');
        audioById.set(item.id, {
          id: item.id,
          type: item.type,
          choiceId: item.choiceId || null,
          text: item.text,
          status: 'ready',
          audioUrl,
        });
      }

      let imageUrl = node.imageUrl;
      if (!imageUrl) {
        const imageResult = await this.pixazo.generateImage(node.illustrationPrompt);
        if (!imageResult?.url) {
          throw new Error(`Pixazo did not return an image for ${node.nodeKey}`);
        }
        const imageResponse = await axios.get(imageResult.url, {
          responseType: 'arraybuffer',
          timeout: 120000,
        });
        const storageKey = `demo-story/${story.slug}/${DEMO_MEDIA_VERSION}/images/${node.nodeKey}.png`;
        imageUrl = await this.storage.upload(
          storageKey,
          Buffer.from(imageResponse.data),
          imageResponse.headers['content-type'] || 'image/png',
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
