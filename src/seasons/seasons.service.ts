import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { JsonGenerationOptions, OpenRouterService } from '../openrouter/openrouter.service';
import { PixazoService } from '../pixazo/pixazo.service';
import { StorageService } from '../storage/storage.service';
import { AudioMetadataService } from '../audio-metadata/audio-metadata.service';
import { PromptsService } from '../prompts/prompts.service';
import { validateSeasonFramework } from './framework-validator';
import { Season } from './entities/season.entity';
import { SeasonFramework } from './entities/season-framework.entity';
import { Hero } from './entities/hero.entity';
import { Episode } from './entities/episode.entity';
import { GenerationJob } from './entities/generation-job.entity';
import { EpisodeChoice } from './entities/episode-choice.entity';
import { CrystalWallet } from './entities/crystal-wallet.entity';
import { CrystalLedgerEntry } from './entities/crystal-ledger.entity';
import { Illustration } from './entities/illustration.entity';
import { StorybookEntry } from './entities/storybook-entry.entity';
import { PreparedEpisode } from './entities/prepared-episode.entity';
import { SeasonCharacter } from './entities/season-character.entity';
import { LearningEvent } from './entities/learning-event.entity';
import { BonusPracticeState } from './entities/bonus-practice-state.entity';
import { ChildProfile } from '../users/entities/child-profile.entity';
import { SeasonCharactersService } from './tti/season-characters.service';
import { TtiPromptService } from './tti/tti-prompt.service';
import { FileLogger } from '../logging/file-logger.service';
import { getStoryWorldPreset } from './story-worlds';
import {
  buildVocabularyTarget,
  sliceFrameworkForEpisode,
  sliceSeasonBibleForEpisode,
  sliceStoryState,
  summarizeEpisodeForPlan,
} from './story-context.util';

type StartSeasonPayload = {
  ownerUserId: string;
  theme: string;
  world: string;
  vocabularyFocus: string[];
  preferredTone: string;
  comments: string;
  learningThemes?: string[];
  interfaceLanguage?: string;
  heroPreferences?: {
    preferredName: string;
    heroType: string;
    traits: string[];
    companion: string;
    favoriteColor: string;
    accessory: string;
    description?: string;
    ageYears?: number;
    gender?: string;
  };
  storyDirection?: Record<string, any>;
  heroDirection?: Record<string, any>;
};

const PROMPT_VERSION = 'season-v3';
const HERO_PROMPT_VERSION = 'hero-v2';
const EPISODE_PROMPT_VERSION = 'episode-v6';
const PREPARED_IMAGE_PROMPT_VERSION = 'prepared-image-v1';
const PREPARED_PLAN_PROMPT_VERSION = 'prepared-next-v3';
const PREPARED_PROSE_PROMPT_VERSION = 'prepared-next-v3';
const TTS_JOB_PROMPT_VERSION = 'tts-job-v2';
const SEASON_TITLE_PROMPT_VERSION = 'season-title-v1';
const EPISODE_MIN_WORDS = 240;
const EPISODE_MAX_WORDS = 320;
const ILLUSTRATION_UNLOCK_COST = 3;
const INITIAL_CRYSTAL_GRANT = 9;
const PREPARED_EPISODE_PROSE_MAX_ATTEMPTS = 3;
const PREPARED_EPISODE_PROSE_RETRY_DELAYS_MS = [2000, 5000, 10000];
const CHAPTER_TTS_MAX_CHARS = 600;
const CHAPTER_TTS_MAX_WORDS = 110;
const CHAPTER_TTS_MAX_PARTS = 3;
const PIXAZO_CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
const PIXAZO_CIRCUIT_FAILURE_THRESHOLD = 3;
const ILLUSTRATION_DOWNLOAD_MAX_ATTEMPTS = 6;
const ILLUSTRATION_DOWNLOAD_RETRY_DELAYS_MS = [2000, 5000, 10000, 15000, 20000, 30000];
const ILLUSTRATION_DOWNLOAD_TIMEOUT_MS = 120000;
const ILLUSTRATION_UPLOAD_MAX_ATTEMPTS = 2;
const PREPARED_ILLUSTRATION_MODERATION_MAX_ATTEMPTS = 3;
const STALE_PROCESSING_JOB_TIMEOUT_MS = 3 * 60 * 1000;
const GENERATION_JOB_MAX_AGE_MS = 20 * 60 * 1000;
const GENERATION_JOB_MAX_ATTEMPTS = 3;
const GENERATION_JOB_RETRY_COOLDOWN_MS = 45 * 1000;
const PREPARED_ILLUSTRATION_WAIT_TIMEOUT_MS = 120 * 1000;
const PREPARED_ILLUSTRATION_WAIT_POLL_MS = 2000;
const STARTUP_ORPHAN_JOB_AGE_MS = 90 * 1000;
const BONUS_RECAP_SIZE = 3;
const BONUS_STORY_RECAP_COOLDOWN_EPISODES = 10;
const WRITING_PRACTICE_WORD_COUNT = 4;
const WRITING_PRACTICE_COOLDOWN_EPISODES = 5;

type BonusPracticeOrigin = 'story' | 'home';
type BonusPracticeType = 'speaking_single' | 'speaking_recap' | 'spelling_test';

type PendingSpeakingPhrase = {
  itemId: string;
  phraseText: string;
  episodeId: string;
  episodeNumber: number;
  status: 'pending' | 'completed';
  createdAt: string;
  completedAt?: string | null;
};

type WritingChallengeWord = {
  term: string;
  translationRu: string;
  meaningInContext?: string;
  episodeId?: string | null;
  episodeNumber?: number | null;
};

type WritingWordProgress = {
  term: string;
  hintsUsed: ('first_letter' | 'translation')[];
  attempts: number;
  reward: number;
  rewardEligible?: boolean;
  completed: boolean;
  correct: boolean;
  revealed: boolean;
};

type WritingTermProgress = {
  correctStreak: number;
  firstRewardAwarded: boolean;
  lastPracticedEpisodeNumber: number;
  nextReviewEpisodeNumber: number;
  mastered: boolean;
};

type WritingChallengeSnapshot = {
  challengeId: string;
  status: 'active' | 'completed';
  words: WritingChallengeWord[];
  progress: WritingWordProgress[];
  currentIndex: number;
  totalReward: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

type WritingState = {
  activeChallenge?: WritingChallengeSnapshot | null;
  lastEligibleEpisodeNumber?: number;
  lastPromptedEpisodeNumber?: number;
  recentTerms?: string[];
  termProgress?: Record<string, WritingTermProgress>;
};

@Injectable()
export class SeasonsService {
  // Coalesce visual work per season. `getSeason` is polled by the creation UI, so
  // duplicate requests must observe the same in-flight hero/cover generation.
  private readonly visualBackfillInFlight = new Map<string, Promise<void>>();
  private readonly heroReferenceImageInFlight = new Map<string, Promise<void>>();
  private readonly seasonCoverInFlight = new Map<string, Promise<void>>();
  private readonly seasonTitleQueueInFlight = new Map<string, Promise<void>>();
  /** Recent Pixazo failure timestamps for prefetch image circuit-breaking. */
  private readonly pixazoFailureTimestamps: number[] = [];

  constructor(
    @InjectRepository(Season)
    private readonly seasonsRepository: Repository<Season>,
    @InjectRepository(SeasonFramework)
    private readonly seasonFrameworksRepository: Repository<SeasonFramework>,
    @InjectRepository(Hero)
    private readonly heroesRepository: Repository<Hero>,
    @InjectRepository(Episode)
    private readonly episodesRepository: Repository<Episode>,
    @InjectRepository(EpisodeChoice)
    private readonly episodeChoicesRepository: Repository<EpisodeChoice>,
    @InjectRepository(GenerationJob)
    private readonly generationJobsRepository: Repository<GenerationJob>,
    @InjectRepository(CrystalWallet)
    private readonly crystalWalletsRepository: Repository<CrystalWallet>,
    @InjectRepository(CrystalLedgerEntry)
    private readonly crystalLedgerRepository: Repository<CrystalLedgerEntry>,
    @InjectRepository(Illustration)
    private readonly illustrationsRepository: Repository<Illustration>,
    @InjectRepository(StorybookEntry)
    private readonly storybookEntriesRepository: Repository<StorybookEntry>,
    @InjectRepository(PreparedEpisode)
    private readonly preparedEpisodesRepository: Repository<PreparedEpisode>,
    @InjectRepository(LearningEvent)
    private readonly learningEventsRepository: Repository<LearningEvent>,
    @InjectRepository(BonusPracticeState)
    private readonly bonusPracticeStatesRepository: Repository<BonusPracticeState>,
    @InjectRepository(ChildProfile)
    private readonly childProfilesRepository: Repository<ChildProfile>,
    private readonly dataSource: DataSource,
    private readonly openRouter: OpenRouterService,
    private readonly pixazo: PixazoService,
    private readonly seasonCharactersService: SeasonCharactersService,
    private readonly ttiPromptService: TtiPromptService,
    private readonly storage: StorageService,
    private readonly audioMetadata: AudioMetadataService,
    private readonly prompts: PromptsService,
    private readonly logger: FileLogger,
  ) {}

  async startSeason(payload: StartSeasonPayload) {
    const seasonId = uuidv4();
    const now = new Date();
    const profile = await this.requireCompleteChildProfile(payload.ownerUserId);
    const childProfile = {
      childName: profile.displayName,
      childAge: String(profile.age),
      childGender: profile.gender,
      languageLevel: profile.englishLevel,
    };
    const seasonSetup = {
      theme: payload.theme.trim(),
      world: payload.world.trim(),
      vocabularyFocus: payload.vocabularyFocus.filter(Boolean),
      preferredTone: payload.preferredTone.trim(),
      comments: payload.comments.trim(),
      learningThemes: (payload.learningThemes || []).filter(Boolean).slice(0, 2),
      interfaceLanguage: payload.interfaceLanguage || 'english',
      storyDirection: payload.storyDirection || null,
      heroDirection: payload.heroDirection || null,
      storyWorld: this.resolveStoryWorldContext(payload.storyDirection, payload.world),
    };

    const season = this.seasonsRepository.create({
      seasonId,
      ownerUserId: payload.ownerUserId,
      childProfile,
      seasonSetup,
      status: 'setup_pending',
      promptVersion: PROMPT_VERSION,
      currentEpisodeNumber: 1,
      currentMiniArc: 1,
      storyState: {
        pendingHeroPreferences: payload.heroPreferences || null,
        wizardCompletedAt: now.toISOString(),
      },
      createdAt: now,
      updatedAt: now,
    });
    await this.seasonsRepository.save(season);
    await this.getOrCreateCrystalWallet(payload.ownerUserId, seasonId);

    const seasonFramework = this.seasonFrameworksRepository.create({
      id: uuidv4(),
      seasonId,
      framework: {},
      seasonBible: {},
      episodeOutline: {},
      generationStatus: 'pending',
      promptVersion: PROMPT_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    await this.seasonFrameworksRepository.save(seasonFramework);

    return {
      seasonId,
      status: season.status,
    };
  }

  private async generateSeasonFrameworkStack(
    season: Season,
    seasonFramework: SeasonFramework,
  ) {
    const protagonist = this.buildSeasonProtagonistContext(season);
    const targetAudience = this.buildSeasonTargetAudience(season, protagonist);
    let framework = await this.generateStrategicSeasonFramework(protagonist, targetAudience, season.seasonSetup);
    let validation = validateSeasonFramework(framework);
    if (!validation.valid) {
      console.warn(`Framework validation failed (${validation.issues.join('; ')}), retrying...`);
      const retryFramework = await this.generateStrategicSeasonFramework(protagonist, targetAudience, season.seasonSetup);
      const retryValidation = validateSeasonFramework(retryFramework);
      if (retryValidation.valid) {
        framework = retryFramework;
        validation = retryValidation;
      } else {
        throw new Error(`Framework retry failed validation: ${retryValidation.issues.join('; ')}`);
      }
    }

    const seasonBible = await this.generateSeasonBible(protagonist, season.seasonSetup, framework);
    const episodeOutline = await this.generateEpisodeOutline(framework, seasonBible);

    season.storyState = {
      ...this.buildInitialStoryState(protagonist, season.seasonSetup, framework),
      ...(season.storyState || {}),
    };
    season.status = 'framework_ready';
    season.updatedAt = new Date();
    await this.seasonsRepository.save(season);

    seasonFramework.framework = framework;
    seasonFramework.seasonBible = seasonBible;
    seasonFramework.episodeOutline = episodeOutline;
    seasonFramework.generationStatus = 'ready';
    seasonFramework.updatedAt = new Date();
    await this.seasonFrameworksRepository.save(seasonFramework);

    await this.seasonCharactersService.syncFromSeasonBible(season.seasonId, seasonBible, null);

    return { framework, seasonBible, episodeOutline };
  }

  async getHomeSummary(ownerUserId: string) {
    const childProfile = await this.childProfilesRepository.findOne({ where: { userId: ownerUserId } });
    const seasons = await this.seasonsRepository.find({
      where: { ownerUserId },
      order: { updatedAt: 'DESC' },
    });

    for (const season of seasons) {
      void this.ensureSeasonVisualAssetsInBackground(season.seasonId);
    }

    const wallet = seasons.length > 0
      ? await this.getOrCreateCrystalWallet(ownerUserId, seasons[0].seasonId)
      : null;
    const crystalBalance = wallet ? await this.computeOwnerCrystalBalance(ownerUserId) : 0;

    if (seasons.length === 0) {
      return {
        ownerUserId,
        hasSeasons: false,
        crystalBalance,
        childProfile: this.mapChildProfile(childProfile),
        activeSeason: null,
        seasons: [],
      };
    }

    const frameworks = await this.seasonFrameworksRepository.find({
      where: seasons.map((s) => ({ seasonId: s.seasonId })),
    });
    const frameworkMap = new Map(frameworks.map((f) => [f.seasonId, f]));
    const activeSeason = seasons[0];
    const activeFramework = frameworkMap.get(activeSeason.seasonId);
    const bonusState = await this.getOrCreateBonusPracticeState(activeSeason);
    const bonusSummary = await this.buildBonusPracticeSummary(activeSeason, bonusState, 'home');
    const parentSnapshot = await this.buildHomeParentSnapshot(ownerUserId, seasons);
    const outlineEpisodes = activeFramework?.episodeOutline?.episodes || [];
    const currentOutline = outlineEpisodes.find(
      (ep: any) => Number(ep.episodeNumber) === activeSeason.currentEpisodeNumber,
    );
    const totalEpisodes = outlineEpisodes.length || 96;
    const completedChoices = await this.episodeChoicesRepository.count({
      where: { seasonId: activeSeason.seasonId },
    });
    const jobs = await this.generationJobsRepository.find({
      where: { seasonId: activeSeason.seasonId, status: 'pending' },
    });
    const currentEpisode = await this.episodesRepository.findOne({
      where: { seasonId: activeSeason.seasonId, episodeNumber: activeSeason.currentEpisodeNumber },
    });

    const readiness = this.mapGenerationReadiness(jobs, currentEpisode);

    return {
      ownerUserId,
      hasSeasons: true,
      crystalBalance,
      childProfile: this.mapChildProfile(childProfile),
      activeSeason: {
        seasonId: activeSeason.seasonId,
        childName: activeSeason.childProfile?.childName || '',
        title: this.getCanonicalSeasonTitle(activeSeason, activeFramework),
        theme: activeSeason.seasonSetup?.theme || '',
        world: activeSeason.seasonSetup?.world || '',
        coverImageUrl: this.mapStorageUrl(activeSeason.seasonSetup?.seasonCoverImageUrl),
        status: activeSeason.status,
        currentEpisodeNumber: activeSeason.currentEpisodeNumber,
        currentEpisodeTitle: currentOutline?.title || currentEpisode?.title || '',
        progressPercent: Math.round((completedChoices / totalEpisodes) * 100),
        completedEpisodes: completedChoices,
        totalEpisodes,
        readiness,
        lastActivityAt: activeSeason.updatedAt,
        bonusPractice: bonusSummary.home,
      },
      seasons: seasons.map((season) => {
        const fw = frameworkMap.get(season.seasonId);
        const eps = fw?.episodeOutline?.episodes?.length || 96;
        return {
          seasonId: season.seasonId,
          childName: season.childProfile?.childName || '',
          title: this.getCanonicalSeasonTitle(season, fw),
          theme: season.seasonSetup?.theme || '',
          world: season.seasonSetup?.world || '',
          coverImageUrl: this.mapStorageUrl(season.seasonSetup?.seasonCoverImageUrl),
          status: season.status,
          seasonPremise: fw?.framework?.seasonPremise || '',
          centralProblem: fw?.framework?.centralProblem || '',
          currentEpisodeNumber: season.currentEpisodeNumber,
          totalEpisodes: eps,
          updatedAt: season.updatedAt,
          progressPercent: Math.min(100, Math.round((season.currentEpisodeNumber / eps) * 100)),
        };
      }),
      bonusPractice: bonusSummary.home,
      todayActions: {
        spellingAvailableWordsCount: bonusSummary.home.writing.available ? bonusSummary.home.writing.wordCount : 0,
        speakingAvailablePhrasesCount: bonusSummary.home.speakingRecap.count,
        rewardsCount: crystalBalance,
      },
      parentSnapshot,
    };
  }

  private mapLibraryStatus(season: Season): 'active' | 'completed' | 'archived' {
    if (season.storyState?.archived === true) {
      return 'archived';
    }
    if (season.status === 'season_complete') {
      return 'completed';
    }
    return 'active';
  }

  private getCanonicalSeasonTitle(
    season: Season,
    framework?: SeasonFramework | null,
  ): string {
    const title = String(
      season.seasonSetup?.seasonTitle || framework?.framework?.title || '',
    ).trim();
    return this.isUsableSeasonTitle(title) ? title : '';
  }

  private isUsableSeasonTitle(title: string): boolean {
    return title.length >= 3 && title.length <= 80 && !/[^\x00-\x7F]/.test(title) && !/[.!?:]/.test(title);
  }

  private async enqueueMissingSeasonTitleJob(
    season: Season,
    framework?: SeasonFramework | null,
  ): Promise<void> {
    const existingTask = this.seasonTitleQueueInFlight.get(season.seasonId);
    if (existingTask) {
      return existingTask;
    }

    const task = this.enqueueMissingSeasonTitleJobInternal(season, framework).finally(() => {
      this.seasonTitleQueueInFlight.delete(season.seasonId);
    });
    this.seasonTitleQueueInFlight.set(season.seasonId, task);
    return task;
  }

  private async enqueueMissingSeasonTitleJobInternal(
    season: Season,
    framework?: SeasonFramework | null,
  ): Promise<void> {
    if (
      this.getCanonicalSeasonTitle(season, framework) ||
      !framework ||
      framework.generationStatus !== 'ready' ||
      !String(framework.framework?.seasonPremise || '').trim()
    ) {
      return;
    }

    const existing = await this.generationJobsRepository.findOne({
      where: { seasonId: season.seasonId, jobType: 'season_title' },
      order: { createdAt: 'DESC' },
    });
    if (existing) {
      const attemptCount = Number(existing.payload?.attemptCount || 0);
      const retryAfter = existing.updatedAt.getTime() + GENERATION_JOB_MAX_AGE_MS;
      if (
        ['failed', 'expired'].includes(existing.status) &&
        attemptCount < 2 &&
        Date.now() >= retryAfter
      ) {
        existing.status = 'pending';
        existing.error = null;
        existing.updatedAt = new Date();
        await this.generationJobsRepository.save(existing);
        this.logger.log(
          `[SeasonTitle] requeued seasonId=${season.seasonId} attempt=${attemptCount + 1}`,
        );
      }
      return;
    }

    const now = new Date();
    await this.generationJobsRepository.save(
      this.generationJobsRepository.create({
        jobId: uuidv4(),
        seasonId: season.seasonId,
        episodeId: null,
        jobType: 'season_title',
        status: 'pending',
        payload: { attemptCount: 0 },
        result: {},
        error: null,
        promptVersion: SEASON_TITLE_PROMPT_VERSION,
        createdAt: now,
        updatedAt: now,
      }),
    );
    this.logger.log(`[SeasonTitle] queued seasonId=${season.seasonId}`);
  }

  /** Explicit maintenance operation only. Read paths never enqueue legacy title work. */
  async backfillMissingSeasonTitles(): Promise<{ scanned: number; queued: number }> {
    const seasons = await this.seasonsRepository.find({ order: { updatedAt: 'ASC' } });
    const frameworks = await this.seasonFrameworksRepository.find({
      where: seasons.map((season) => ({ seasonId: season.seasonId })),
    });
    const frameworkBySeason = new Map(frameworks.map((framework) => [framework.seasonId, framework]));
    let queued = 0;

    for (const season of seasons) {
      const framework = frameworkBySeason.get(season.seasonId);
      if (this.getCanonicalSeasonTitle(season, framework) || !framework || framework.generationStatus !== 'ready') continue;
      const active = await this.generationJobsRepository.findOne({
        where: [
          { seasonId: season.seasonId, jobType: 'season_title', status: 'pending' },
          { seasonId: season.seasonId, jobType: 'season_title', status: 'processing' },
        ],
      });
      if (active) continue;
      const now = new Date();
      await this.generationJobsRepository.save(this.generationJobsRepository.create({
        jobId: uuidv4(), seasonId: season.seasonId, episodeId: null, jobType: 'season_title',
        status: 'pending', payload: { attemptCount: 0, lifecycle: { rootCreatedAt: now.toISOString(), recoveryCount: 0 } },
        result: {}, error: null, promptVersion: SEASON_TITLE_PROMPT_VERSION, createdAt: now, updatedAt: now,
      }));
      queued += 1;
    }
    this.logger.log(`[SeasonTitle] explicit_backfill scanned=${seasons.length} queued=${queued}`);
    return { scanned: seasons.length, queued };
  }

  private countLearnedWords(season: Season): number {
    const exposures = Array.isArray(season.storyState?.vocabularyExposures)
      ? season.storyState.vocabularyExposures
      : [];
    const terms = new Map<string, number>();
    for (const item of exposures) {
      const term = String(item?.term || '').trim().toLowerCase();
      if (!term) {
        continue;
      }
      terms.set(term, (terms.get(term) || 0) + Number(item?.exposureCountDelta || 1));
    }
    return Array.from(terms.values()).filter((count) => count >= 3).length;
  }

  async getLibrary(ownerUserId: string) {
    const seasons = await this.seasonsRepository.find({
      where: { ownerUserId },
      order: { updatedAt: 'DESC' },
    });

    if (seasons.length === 0) {
      return { currentSeason: null, seasons: [] };
    }

    for (const season of seasons) {
      void this.ensureSeasonVisualAssetsInBackground(season.seasonId);
    }

    const seasonIds = seasons.map((season) => season.seasonId);
    const frameworks = await this.seasonFrameworksRepository.find({
      where: seasonIds.map((seasonId) => ({ seasonId })),
    });
    const frameworkMap = new Map(frameworks.map((framework) => [framework.seasonId, framework]));

    const choices = await this.episodeChoicesRepository.find({
      where: seasonIds.map((seasonId) => ({ seasonId })),
      select: ['seasonId'],
    });
    const completedBySeason = new Map<string, number>();
    for (const choice of choices) {
      completedBySeason.set(choice.seasonId, (completedBySeason.get(choice.seasonId) || 0) + 1);
    }

    const speakingRows = seasonIds.length
      ? await this.learningEventsRepository
          .createQueryBuilder('event')
          .select('event.season_id', 'seasonId')
          .addSelect('COUNT(*)', 'count')
          .where('event.season_id IN (:...seasonIds)', { seasonIds })
          .andWhere('event.event_type = :eventType', { eventType: 'voice_success' })
          .groupBy('event.season_id')
          .getRawMany()
      : [];
    const speakingBySeason = new Map<string, number>(
      speakingRows.map((row) => [String(row.seasonId), Number(row.count || 0)]),
    );

    const storybookRows = seasonIds.length
      ? await this.storybookEntriesRepository
          .createQueryBuilder('entry')
          .select('entry.seasonId', 'seasonId')
          .addSelect('COUNT(*)', 'count')
          .where('entry.seasonId IN (:...seasonIds)', { seasonIds })
          .groupBy('entry.seasonId')
          .getRawMany()
      : [];
    const storybookBySeason = new Map<string, number>(
      storybookRows.map((row) => [String(row.seasonId), Number(row.count || 0)]),
    );

    const currentEpisodes = await this.episodesRepository.find({
      where: seasons.map((season) => ({
        seasonId: season.seasonId,
        episodeNumber: season.currentEpisodeNumber,
      })),
    });
    const currentEpisodeMap = new Map(
      currentEpisodes.map((episode) => [`${episode.seasonId}:${episode.episodeNumber}`, episode]),
    );

    const items = seasons.map((season) => {
      const framework = frameworkMap.get(season.seasonId);
      const outlineEpisodes = framework?.episodeOutline?.episodes || [];
      const totalEpisodes = outlineEpisodes.length || 96;
      const completedEpisodes = completedBySeason.get(season.seasonId) || 0;
      const currentOutline = outlineEpisodes.find(
        (episode: any) => Number(episode.episodeNumber) === season.currentEpisodeNumber,
      );
      const currentEpisode = currentEpisodeMap.get(`${season.seasonId}:${season.currentEpisodeNumber}`);
      const worldId =
        season.seasonSetup?.storyDirection?.worldId ||
        season.seasonSetup?.storyWorld?.id ||
        null;
      const wordsCount = this.countLearnedWords(season);
      const speakingTasksCompletedCount = speakingBySeason.get(season.seasonId) || 0;

      return {
        id: season.seasonId,
        title: this.getCanonicalSeasonTitle(season, framework),
        worldId,
        worldLabel: season.seasonSetup?.world || season.seasonSetup?.storyWorld?.title || '',
        coverImageUrl: this.mapStorageUrl(season.seasonSetup?.seasonCoverImageUrl),
        status: this.mapLibraryStatus(season),
        totalEpisodes,
        completedEpisodes,
        currentEpisodeNumber: season.currentEpisodeNumber,
        currentEpisodeTitle: currentOutline?.title || currentEpisode?.title || '',
        nextEpisodeId: currentEpisode?.episodeId || null,
        lastActivityAt: season.updatedAt,
        updatedAt: season.updatedAt,
        createdAt: season.createdAt,
        wordsCount: wordsCount || undefined,
        wordsTrainedCount: wordsCount || undefined,
        speakingTasksCount: speakingTasksCompletedCount || undefined,
        speakingTasksCompletedCount: speakingTasksCompletedCount || undefined,
        storybookAvailable: (storybookBySeason.get(season.seasonId) || 0) > 0,
        parentReportAvailable: completedEpisodes > 0 || speakingTasksCompletedCount > 0 || wordsCount > 0,
      };
    });

    const currentSeason =
      items.find((item) => item.status === 'active') ||
      items.find((item) => item.status === 'completed') ||
      items[0] ||
      null;

    return {
      currentSeason,
      seasons: items,
    };
  }

  async setSeasonArchived(seasonId: string, archived: boolean) {
    let season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }
    season.storyState = {
      ...(season.storyState || {}),
      archived,
    };
    season.updatedAt = new Date();
    await this.seasonsRepository.save(season);

    return { seasonId, archived };
  }

  private async buildHomeParentSnapshot(ownerUserId: string, seasons: Season[]) {
    if (!seasons.length) {
      return {
        weeklyListeningMinutes: 0,
        completedEpisodesThisWeek: 0,
        newWordsCount: 0,
        speakingPracticeCount: 0,
      };
    }

    const seasonIds = seasons.map((season) => season.seasonId);
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const learningEvents = await this.learningEventsRepository
      .createQueryBuilder('event')
      .where('event.owner_user_id = :ownerUserId', { ownerUserId })
      .andWhere('event.created_at >= :since', { since })
      .andWhere('event.season_id IN (:...seasonIds)', { seasonIds })
      .getMany();

    const weeklyChoices = await this.episodeChoicesRepository
      .createQueryBuilder('choice')
      .where('choice.seasonId IN (:...seasonIds)', { seasonIds })
      .andWhere('choice.createdAt >= :since', { since })
      .getCount();

    const exposures = new Map<string, number>();
    for (const season of seasons) {
      const seasonExposures = Array.isArray(season.storyState?.vocabularyExposures)
        ? season.storyState.vocabularyExposures
        : [];
      for (const item of seasonExposures) {
        const term = String(item?.term || '').trim().toLowerCase();
        if (!term) {
          continue;
        }
        exposures.set(term, (exposures.get(term) || 0) + Number(item?.exposureCountDelta || 1));
      }
    }

    const weeklyListeningSeconds = learningEvents
      .filter((event) => ['audio_listen', 'audio_complete'].includes(event.eventType))
      .reduce((sum, event) => sum + Number(event.payloadJson?.durationSec || 0), 0);

    const speakingPracticeCount = learningEvents.filter((event) => event.eventType === 'voice_success').length;
    const newWordsCount = Array.from(exposures.values()).filter((count) => count >= 3).length;

    return {
      weeklyListeningMinutes: Math.round(weeklyListeningSeconds / 60),
      completedEpisodesThisWeek: weeklyChoices,
      newWordsCount,
      speakingPracticeCount,
    };
  }

  private async getOrCreateBonusPracticeState(season: Season): Promise<BonusPracticeState> {
    const existing = await this.bonusPracticeStatesRepository.findOne({ where: { seasonId: season.seasonId } });
    if (existing) {
      return existing;
    }

    const now = new Date();
    return this.bonusPracticeStatesRepository.save(
      this.bonusPracticeStatesRepository.create({
        stateId: uuidv4(),
        seasonId: season.seasonId,
        ownerUserId: season.ownerUserId,
        skippedSpeakingQueue: [],
        writingState: {},
        storyRecapState: {},
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  private normalizeWritingState(value: Record<string, any> | null | undefined): WritingState {
    const termProgress = Object.entries(value?.termProgress || {}).reduce<Record<string, WritingTermProgress>>(
      (result, [term, raw]) => {
        const key = this.normalizeBonusWord(term);
        if (!key || !raw || typeof raw !== 'object') {
          return result;
        }
        result[key] = {
          correctStreak: Math.max(0, Number((raw as any).correctStreak || 0)),
          firstRewardAwarded: Boolean((raw as any).firstRewardAwarded),
          lastPracticedEpisodeNumber: Math.max(0, Number((raw as any).lastPracticedEpisodeNumber || 0)),
          nextReviewEpisodeNumber: Math.max(0, Number((raw as any).nextReviewEpisodeNumber || 0)),
          mastered: Boolean((raw as any).mastered),
        };
        return result;
      },
      {},
    );

    return {
      activeChallenge: value?.activeChallenge || null,
      lastEligibleEpisodeNumber: Number(value?.lastEligibleEpisodeNumber || 0),
      lastPromptedEpisodeNumber: Number(value?.lastPromptedEpisodeNumber || 0),
      recentTerms: Array.isArray(value?.recentTerms) ? value.recentTerms.map((item: any) => String(item).toLowerCase()) : [],
      termProgress,
    };
  }

  private getExplicitPendingSpeakingQueue(state: BonusPracticeState): PendingSpeakingPhrase[] {
    return (Array.isArray(state.skippedSpeakingQueue) ? state.skippedSpeakingQueue : [])
      .filter((item) => item && item.status !== 'completed')
      .map((item) => ({
        itemId: String(item.itemId),
        phraseText: String(item.phraseText || ''),
        episodeId: String(item.episodeId || ''),
        episodeNumber: Number(item.episodeNumber || 0),
        status: 'pending' as const,
        createdAt: String(item.createdAt || new Date().toISOString()),
        completedAt: item.completedAt ? String(item.completedAt) : null,
      }))
      .filter((item) => item.phraseText && item.episodeId);
  }

  private async getPendingSpeakingQueueForSeason(
    season: Season,
    state: BonusPracticeState,
    voiceLedger: CrystalLedgerEntry[],
  ): Promise<PendingSpeakingPhrase[]> {
    const explicitQueue = this.getExplicitPendingSpeakingQueue(state);
    const successful = new Set(
      voiceLedger
        .map((entry) => this.normalizeSpeakingPhraseKey(String(entry.metadata?.targetPhrase || '')))
        .filter(Boolean),
    );
    const episodes = await this.episodesRepository.find({
      where: { seasonId: season.seasonId },
      order: { episodeNumber: 'ASC' },
    });
    const combined: PendingSpeakingPhrase[] = [];
    const seen = new Set<string>();

    for (const item of explicitQueue) {
      const key = this.normalizeSpeakingPhraseKey(item.phraseText);
      if (!key || successful.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      combined.push(item);
    }

    for (const episode of episodes) {
      if (episode.episodeNumber > season.currentEpisodeNumber) {
        continue;
      }
      const phraseText = String(episode.speakingPrompt || '').trim();
      const key = this.normalizeSpeakingPhraseKey(phraseText);
      if (!phraseText || successful.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      combined.push({
        itemId: `episode:${episode.episodeId}`,
        phraseText,
        episodeId: episode.episodeId,
        episodeNumber: episode.episodeNumber,
        status: 'pending',
        createdAt: episode.createdAt?.toISOString?.() || new Date().toISOString(),
        completedAt: null,
      });
    }

    return combined;
  }

  private async saveBonusPracticeState(state: BonusPracticeState) {
    state.updatedAt = new Date();
    return this.bonusPracticeStatesRepository.save(state);
  }

  private getCurrentEpisodeSpeakingAvailability(
    season: Season,
    episode: Episode | null,
    pendingQueue: PendingSpeakingPhrase[],
    voiceLedger: CrystalLedgerEntry[],
  ) {
    if (!episode) {
      return { available: false };
    }

    const targetPhrase = String(episode.speakingPrompt || '').trim();
    if (!targetPhrase) {
      return { available: false };
    }

    const alreadyAwarded = voiceLedger.some(
      (entry) => this.normalizeSpeakingPhraseKey(String(entry.metadata?.targetPhrase || '')) === this.normalizeSpeakingPhraseKey(targetPhrase),
    );
    const alreadyPending = pendingQueue.some(
      (item) => this.normalizeSpeakingPhraseKey(item.phraseText) === this.normalizeSpeakingPhraseKey(targetPhrase),
    );

    return {
      available: !alreadyAwarded && !alreadyPending,
      episodeId: episode.episodeId,
      episodeNumber: episode.episodeNumber,
      phraseText: targetPhrase,
    };
  }

  private buildRecapAvailability(
    season: Season,
    pendingQueue: PendingSpeakingPhrase[],
    storyRecapState: Record<string, any>,
    origin: BonusPracticeOrigin,
  ) {
    const pending = pendingQueue.slice(0, BONUS_RECAP_SIZE);
    const lastStoryRecapEpisodeNumber = Number(storyRecapState?.lastStoryRecapEpisodeNumber || 0);
    const storyCooldownSatisfied =
      season.currentEpisodeNumber - lastStoryRecapEpisodeNumber >= BONUS_STORY_RECAP_COOLDOWN_EPISODES;

    return {
      available:
        pending.length >= BONUS_RECAP_SIZE &&
        (origin === 'home' || storyCooldownSatisfied),
      pendingCount: pendingQueue.length,
      items: pending,
      maxReward: Math.min(pending.length, BONUS_RECAP_SIZE),
      storyCooldownSatisfied,
      lastStoryRecapEpisodeNumber,
    };
  }

  private normalizeBonusWord(term: string): string {
    return String(term || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9']/g, '');
  }

  private getDefaultWritingTermProgress(): WritingTermProgress {
    return {
      correctStreak: 0,
      firstRewardAwarded: false,
      lastPracticedEpisodeNumber: 0,
      nextReviewEpisodeNumber: 0,
      mastered: false,
    };
  }

  private getWritingReviewDelay(correctStreak: number): number {
    return correctStreak <= 1 ? 2 : 5;
  }

  private async getWritingPracticeWords(
    season: Season,
    writingState: WritingState,
  ): Promise<Array<{ word: WritingChallengeWord; progress: WritingTermProgress; isReview: boolean }>> {
    const episodes = await this.episodesRepository.find({
      where: { seasonId: season.seasonId },
      order: { episodeNumber: 'ASC' },
    });
    const writingEvents = await this.learningEventsRepository.find({
      where: { seasonId: season.seasonId, eventType: In(['writing_success', 'writing_reveal']) },
      order: { createdAt: 'ASC' },
    });
    const legacyProgress = new Map<string, WritingTermProgress>();
    for (const event of writingEvents) {
      const term = this.normalizeBonusWord(String(event.payloadJson?.term || ''));
      if (!term || writingState.termProgress?.[term]) {
        continue;
      }
      if (event.eventType === 'writing_success') {
        // Before spaced repetition shipped, a successful spelling marked a word learned.
        // Preserve that completed learning history instead of re-awarding old words.
        legacyProgress.set(term, {
          correctStreak: 3,
          firstRewardAwarded: true,
          lastPracticedEpisodeNumber: season.currentEpisodeNumber,
          nextReviewEpisodeNumber: 0,
          mastered: true,
        });
      } else if (!legacyProgress.has(term)) {
        legacyProgress.set(term, this.getDefaultWritingTermProgress());
      }
    }

    return this.buildWritingChallengeWordPool(
      episodes.filter((episode) => episode.episodeNumber <= season.currentEpisodeNumber),
    )
      .map((word) => {
        const key = this.normalizeBonusWord(word.term);
        const progress = writingState.termProgress?.[key] || legacyProgress.get(key) || this.getDefaultWritingTermProgress();
        return { word, progress, isReview: progress.correctStreak > 0 };
      })
      .filter(({ progress }) => !progress.mastered)
      .filter(({ progress }) => progress.correctStreak === 0 || progress.nextReviewEpisodeNumber <= season.currentEpisodeNumber)
      .sort((a, b) => {
        // Due reviews are shown before new words; new words stay close to the current story.
        if (a.isReview !== b.isReview) return a.isReview ? -1 : 1;
        if (a.isReview) return a.progress.nextReviewEpisodeNumber - b.progress.nextReviewEpisodeNumber;
        return Number(b.word.episodeNumber || 0) - Number(a.word.episodeNumber || 0);
      });
  }

  private async getWritingEligibility(
    season: Season,
    writingState: WritingState,
    origin: BonusPracticeOrigin,
  ) {
    const activeChallenge = writingState.activeChallenge || null;
    const lastEligibleEpisodeNumber = Number(writingState.lastEligibleEpisodeNumber || 0);
    const availableWords = await this.getWritingPracticeWords(season, writingState);
    const enoughWords = availableWords.length >= WRITING_PRACTICE_WORD_COUNT;
    const lastPromptedEpisodeNumber = Number(writingState.lastPromptedEpisodeNumber || 0);
    const completionCooldownSatisfied =
      season.currentEpisodeNumber - lastEligibleEpisodeNumber >= WRITING_PRACTICE_COOLDOWN_EPISODES;
    const promptCooldownSatisfied =
      season.currentEpisodeNumber - lastPromptedEpisodeNumber >= WRITING_PRACTICE_COOLDOWN_EPISODES;
    const available = Boolean(activeChallenge) || (enoughWords && (origin === 'home' || completionCooldownSatisfied));

    return {
      available,
      activeChallenge,
      lastEligibleEpisodeNumber,
      lastPromptedEpisodeNumber,
      storyPromptAvailable:
        origin === 'story' &&
        !activeChallenge &&
        enoughWords &&
        completionCooldownSatisfied &&
        promptCooldownSatisfied,
      availableWordCount: activeChallenge ? WRITING_PRACTICE_WORD_COUNT : availableWords.length,
      availableWords,
    };
  }

  private mapWritingChallengeForResponse(challenge: WritingChallengeSnapshot | null) {
    if (!challenge) {
      return null;
    }

    const currentWord = challenge.words[challenge.currentIndex] || null;
    const currentProgress = challenge.progress[challenge.currentIndex] || null;
    const completedWords = challenge.progress.filter((item) => item.completed).length;
    const maxReward = challenge.progress.filter((item) => item.rewardEligible ?? true).length;

    return {
      challengeId: challenge.challengeId,
      status: challenge.status,
      currentIndex: challenge.currentIndex,
      wordCount: challenge.words.length,
      completedWords,
      totalReward: challenge.totalReward,
      maxReward,
      currentWord: currentWord
        ? {
            term: currentWord.term,
            translationRu: currentWord.translationRu,
            meaningInContext: currentWord.meaningInContext || '',
            firstLetter: currentWord.term.charAt(0) || '',
            hintsUsed: currentProgress?.hintsUsed || [],
            revealed: currentProgress?.revealed || false,
            rewardEligible: currentProgress?.rewardEligible ?? true,
          }
        : null,
      words: challenge.words.map((word, index) => ({
        term: word.term,
        translationRu: word.translationRu,
        completed: challenge.progress[index]?.completed || false,
        reward: challenge.progress[index]?.reward || 0,
        hintsUsed: challenge.progress[index]?.hintsUsed || [],
        rewardEligible: challenge.progress[index]?.rewardEligible ?? true,
      })),
    };
  }

  private async buildBonusPracticeSummary(
    season: Season,
    bonusState: BonusPracticeState,
    origin: BonusPracticeOrigin,
  ) {
    const currentEpisode = await this.episodesRepository.findOne({
      where: { seasonId: season.seasonId, episodeNumber: season.currentEpisodeNumber },
    });
    const voiceLedger = await this.crystalLedgerRepository.find({
      where: {
        ownerUserId: season.ownerUserId,
        seasonId: season.seasonId,
        reason: In(['voice_attempt', 'bonus_speaking']),
      },
    });
    const pendingQueue = await this.getPendingSpeakingQueueForSeason(season, bonusState, voiceLedger);
    const speakingSingle = this.getCurrentEpisodeSpeakingAvailability(season, currentEpisode, pendingQueue, voiceLedger);
    const speakingRecap = this.buildRecapAvailability(season, pendingQueue, bonusState.storyRecapState || {}, origin);
    const writingState = this.normalizeWritingState(bonusState.writingState);
    const writingEligibility = await this.getWritingEligibility(season, writingState, origin);
    const writingMaxReward = this.mapWritingChallengeForResponse(writingState.activeChallenge || null)?.maxReward
      ?? WRITING_PRACTICE_WORD_COUNT;

    return {
      season: {
        speaking: {
          single: {
            available: Boolean(speakingSingle.available),
            phraseText: speakingSingle['phraseText'] || null,
            episodeId: speakingSingle['episodeId'] || null,
            episodeNumber: speakingSingle['episodeNumber'] || null,
            reward: 1,
          },
          recap: {
            available: speakingRecap.available,
            pendingCount: speakingRecap.pendingCount,
            maxReward: BONUS_RECAP_SIZE,
          },
        },
        writing: {
          available: writingEligibility.available,
          active: Boolean(writingEligibility.activeChallenge),
          wordCount: writingEligibility.availableWordCount,
          maxReward: writingMaxReward,
        },
        storyLaunch: {
          speakingType: speakingRecap.available ? 'speaking_recap' : null,
          speakingAvailable: Boolean(speakingRecap.available),
          writingAvailable: writingEligibility.available,
          writingPromptAvailable: writingEligibility.storyPromptAvailable,
        },
      },
      home: {
        speakingRecap: {
          available: speakingRecap.pendingCount >= BONUS_RECAP_SIZE,
          count: speakingRecap.pendingCount,
          maxReward: BONUS_RECAP_SIZE,
        },
        writing: {
          available: writingEligibility.available,
          active: Boolean(writingEligibility.activeChallenge),
          wordCount: writingEligibility.availableWordCount,
          maxReward: writingMaxReward,
        },
      },
    };
  }

  private mapGenerationReadiness(
    pendingJobs: GenerationJob[],
    currentEpisode: Episode | null,
  ) {
    const hasPendingPrepared = pendingJobs.some((j) =>
      ['prepared_branch_plan', 'prepared_episode_prose', 'prepared_episode'].includes(j.jobType),
    );
    const hasPendingTts = pendingJobs.some((j) => j.jobType === 'prepared_tts_chunk');
    const hasPendingImage = pendingJobs.some((j) =>
      ['image_generation', 'prepared_image_generation'].includes(j.jobType),
    );

    const audioReady = currentEpisode?.audioChunks?.some(
      (c: any) => c.status === 'ready' || c.status === 'ready_dry_run',
    ) ?? false;

    return {
      nextEpisodePreparing: hasPendingPrepared,
      audioPreparing: hasPendingTts,
      illustrationPreparing: hasPendingImage,
      audioReady,
      illustrationReady: !hasPendingImage,
      allReady: !hasPendingPrepared && !hasPendingTts && audioReady,
    };
  }

  async previewHero(payload: {
    ownerUserId: string;
    world: string;
    worldId?: string;
    theme: string;
    preferredTone?: string;
    vocabularyFocus?: string[];
    heroDirection?: {
      preferredName?: string;
      gender?: 'girl' | 'boy' | 'ai_decides';
      age?: number;
      traits?: string[];
      companion?: string;
      description?: string;
    };
  }) {
    const profile = await this.requireCompleteChildProfile(payload.ownerUserId);
    this.logger.log(
      `[HeroPreview] request worldId=${payload.worldId || 'none'} gender=${payload.heroDirection?.gender || 'ai_decides'} age=${payload.heroDirection?.age || profile.age} hasPreferredName=${Boolean(payload.heroDirection?.preferredName?.trim())} hasManualDescription=${Boolean(payload.heroDirection?.description?.trim())}`,
    );
    const childProfile = {
      childName: profile.displayName,
      childAge: String(profile.age),
      childGender: profile.gender,
      languageLevel: profile.englishLevel,
    };
    const seasonSetup = {
      theme: payload.theme.trim(),
      world: payload.world.trim(),
      vocabularyFocus: payload.vocabularyFocus || [],
      preferredTone: payload.preferredTone || 'warm adventure',
      comments: '',
      storyWorld: this.resolveStoryWorldContext({ worldId: payload.worldId }, payload.world),
    };
    const framework = {
      seasonPremise: `${payload.world}: ${payload.theme}`,
      centralProblem: payload.theme,
      heroWant: 'to explore and help friends',
      heroNeed: 'to listen and work with others',
    };
    const seasonBible = { worldOverview: payload.world, vocabularyPlan: { coreWords: seasonSetup.vocabularyFocus } };
    const requestedName = String(payload.heroDirection?.preferredName || '').trim();
    const requestedGender = payload.heroDirection?.gender || 'ai_decides';
    const requestedAge = Number(payload.heroDirection?.age || profile.age);
    const requestedTraits = Array.isArray(payload.heroDirection?.traits)
      ? payload.heroDirection.traits.map((trait) => String(trait || '').trim()).filter(Boolean).slice(0, 4)
      : [];
    const requestedCompanion = String(payload.heroDirection?.companion || '').trim();
    const requestedDescription = String(payload.heroDirection?.description || '').trim();
    const heroDirection = {
      preferredName: requestedName || undefined,
      gender: requestedGender,
      age: Number.isFinite(requestedAge) ? requestedAge : undefined,
      traits: requestedTraits,
      companion: requestedCompanion || undefined,
      description: requestedDescription || undefined,
    };

    const defaults = await this.generateHeroDraftDefaults(
      { ...childProfile, heroDirection },
      seasonSetup,
      framework,
      seasonBible,
    );
    const presetIndex = Math.abs(
      (payload.world + profile.age).split('').reduce((a, c) => a + c.charCodeAt(0), 0),
    ) % 10;

    return {
      ...defaults,
      preferredName: requestedName || defaults.preferredName,
      descriptionRu: requestedName
        ? this.normalizeHeroPreviewDescriptionName(defaults.descriptionRu, requestedName)
        : defaults.descriptionRu,
      presetImageUrl: `/hero-presets/preset-${presetIndex + 1}.svg`,
      caption: `${payload.world}. Hero for age ${profile.age}.`,
    };
  }

  private normalizeHeroPreviewDescriptionName(description: string, preferredName: string) {
    const normalizedName = preferredName.trim();
    if (!normalizedName || !description) return description;

    return description.replace(
      /^\s*[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё' -]{0,39}\s*[-:—]\s*/u,
      `${normalizedName} - `,
    );
  }

  async bootstrapSeasonFromWizard(seasonId: string) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    let seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
    if (!seasonFramework) {
      throw new Error('Season framework not found');
    }

    if (seasonFramework.generationStatus === 'processing') {
      return this.getSeason(seasonId);
    }

    if (seasonFramework.generationStatus !== 'ready') {
      seasonFramework.generationStatus = 'processing';
      seasonFramework.updatedAt = new Date();
      await this.seasonFrameworksRepository.save(seasonFramework);
      await this.generateSeasonFrameworkStack(season, seasonFramework);
      seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
      if (!seasonFramework) {
        throw new Error('Season framework not found');
      }
    }

    const pendingPrefs = season.storyState?.pendingHeroPreferences;
    if (pendingPrefs && season.status === 'framework_ready') {
      await this.generateHero(seasonId, pendingPrefs);
      season.storyState = { ...season.storyState, pendingHeroPreferences: null };
      await this.seasonsRepository.save(season);
    }

    const refreshed = await this.seasonsRepository.findOne({ where: { seasonId } });
    const existingHero = await this.heroesRepository.findOne({ where: { seasonId } });
    if (refreshed && existingHero && refreshed.status === 'framework_ready') {
      refreshed.status = 'hero_ready';
      refreshed.updatedAt = new Date();
      await this.seasonsRepository.save(refreshed);
    }

    if (existingHero) {
      const episodes = await this.episodesRepository.find({ where: { seasonId } });
      if (episodes.length === 0) {
        return this.generateFirstEpisode(seasonId);
      }
    }

    return this.getSeason(seasonId);
  }

  /**
   * Maintenance repair for a season created by the old wizard pipeline, where
   * child account data could be used before the confirmed hero was available.
   * R2 objects are intentionally retained; only invalid generated DB content is replaced.
   */
  async rebuildSeasonForProtagonistConsistency(seasonId: string) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const protagonist = this.buildSeasonProtagonistContext(season);
    if (!protagonist.name || protagonist.name === 'Hero') {
      throw new Error('Confirmed hero name is required before rebuilding season content');
    }

    const seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
    if (!seasonFramework) {
      throw new Error('Season framework not found');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(GenerationJob, { seasonId });
      await manager.delete(PreparedEpisode, { seasonId });
      await manager.delete(EpisodeChoice, { seasonId });
      await manager.delete(StorybookEntry, { seasonId });
      await manager.delete(Illustration, { seasonId });
      await manager.delete(SeasonCharacter, { seasonId });
      await manager.delete(LearningEvent, { seasonId });
      await manager.delete(BonusPracticeState, { seasonId });
      await manager.delete(Episode, { seasonId });

      season.storyState = {
        wizardCompletedAt: season.storyState?.wizardCompletedAt || new Date().toISOString(),
      };
      season.status = 'setup_pending';
      season.currentEpisodeNumber = 1;
      season.currentMiniArc = 1;
      season.updatedAt = new Date();
      await manager.save(season);

      seasonFramework.framework = {};
      seasonFramework.seasonBible = {};
      seasonFramework.episodeOutline = {};
      seasonFramework.generationStatus = 'pending';
      seasonFramework.updatedAt = new Date();
      await manager.save(seasonFramework);
    });

    this.logger.warn(`[ProtagonistRepair] Rebuilding generated content for seasonId=${seasonId} hero=${protagonist.name}`);
    await this.generateSeasonFrameworkStack(season, seasonFramework);

    const hero = await this.heroesRepository.findOne({ where: { seasonId } });
    if (!hero) {
      throw new Error('Hero profile is required before rebuilding the first episode');
    }

    return this.generateFirstEpisode(seasonId);
  }

  async recordLearningEvent(
    seasonId: string,
    payload: {
      episodeId?: string;
      eventType: string;
      payload?: Record<string, any>;
    },
  ) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const now = new Date();
    await this.learningEventsRepository.save(
      this.learningEventsRepository.create({
        eventId: uuidv4(),
        ownerUserId: season.ownerUserId,
        seasonId,
        episodeId: payload.episodeId || null,
        eventType: payload.eventType,
        payloadJson: payload.payload || {},
        createdAt: now,
      }),
    );

    return { recorded: true };
  }

  async getLearningProgress(
    ownerUserId: string,
    options: { range?: string; seasonId?: string } = {},
  ) {
    const range = options.range || 'week';
    const daysBack = range === '30days' ? 30 : 7;
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const previousSince = new Date(since);
    previousSince.setDate(previousSince.getDate() - daysBack);

    const seasons = await this.seasonsRepository.find({
      where: { ownerUserId },
      order: { updatedAt: 'DESC' },
    });
    const seasonIds = options.seasonId
      ? seasons.some((s) => s.seasonId === options.seasonId)
        ? [options.seasonId]
        : []
      : seasons.map((s) => s.seasonId);

    const loadEvents = async (from: Date, to?: Date) => {
      if (seasonIds.length === 0) {
        return [] as LearningEvent[];
      }
      const qb = this.learningEventsRepository
        .createQueryBuilder('e')
        .where('e.owner_user_id = :ownerUserId', { ownerUserId })
        .andWhere('e.created_at >= :from', { from });
      if (to) {
        qb.andWhere('e.created_at < :to', { to });
      }
      if (seasonIds.length === 1) {
        qb.andWhere('e.season_id = :seasonId', { seasonId: seasonIds[0] });
      } else {
        qb.andWhere('e.season_id IN (:...seasonIds)', { seasonIds });
      }
      return qb.orderBy('e.created_at', 'ASC').getMany();
    };

    const [events, previousEvents] = await Promise.all([
      loadEvents(since),
      loadEvents(previousSince, since),
    ]);

    const progress = await this.getUserProgress(ownerUserId);
    const exposures = progress.exposuresByWord || [];

    const listeningEvents = events.filter((e) =>
      ['audio_listen', 'audio_complete'].includes(e.eventType),
    );
    const previousListeningEvents = previousEvents.filter((e) =>
      ['audio_listen', 'audio_complete'].includes(e.eventType),
    );
    const voiceSuccessEvents = events.filter((e) => e.eventType === 'voice_success');
    const voiceAttemptEvents = events.filter((e) => e.eventType === 'voice_attempt');
    const previousVoiceSuccessEvents = previousEvents.filter((e) => e.eventType === 'voice_success');
    const writingSuccessEvents = events.filter((e) => e.eventType === 'writing_success');
    const writingRevealEvents = events.filter((e) => e.eventType === 'writing_reveal');
    const previousWritingSuccessEvents = previousEvents.filter((e) => e.eventType === 'writing_success');

    const allTimeWritingSuccess =
      seasonIds.length > 0
        ? await this.learningEventsRepository.find({
            where: seasonIds.map((sid) => ({ seasonId: sid, eventType: 'writing_success' as const })),
          })
        : [];
    const learnedTerms = new Set(
      allTimeWritingSuccess
        .map((event) => this.normalizeBonusWord(String(event.payloadJson?.term || '')))
        .filter(Boolean),
    );

    const translationByTerm = new Map<string, string>();
    const lastPracticedByTerm = new Map<string, Date>();
    for (const event of [...writingSuccessEvents, ...writingRevealEvents, ...events.filter((e) => e.eventType === 'vocab_exposure')]) {
      const term = this.normalizeBonusWord(String(event.payloadJson?.term || ''));
      if (!term) {
        continue;
      }
      const prev = lastPracticedByTerm.get(term);
      if (!prev || event.createdAt > prev) {
        lastPracticedByTerm.set(term, event.createdAt);
      }
      const translation = String(event.payloadJson?.translationRu || '').trim();
      if (translation && !translationByTerm.has(term)) {
        translationByTerm.set(term, translation);
      }
    }

    const scopedSeasonIds = options.seasonId ? seasonIds : seasons.map((s) => s.seasonId);
    if (scopedSeasonIds.length > 0) {
      const episodeRows = await this.episodesRepository.find({
        where: scopedSeasonIds.map((seasonId) => ({ seasonId })),
        select: ['episodeId', 'seasonId', 'highlightedVocabulary'],
      });
      for (const episode of episodeRows) {
        for (const vocab of Array.isArray(episode.highlightedVocabulary) ? episode.highlightedVocabulary : []) {
          const term = this.normalizeBonusWord(String(vocab?.term || ''));
          const translationRu = String(vocab?.translationRu || '').trim();
          if (term && translationRu && !translationByTerm.has(term)) {
            translationByTerm.set(term, translationRu);
          }
        }
      }
    }

    const sumListeningSeconds = (list: LearningEvent[]) =>
      list.reduce((sum, e) => sum + Number(e.payloadJson?.durationSec || 0), 0);

    const totalListeningSeconds = sumListeningSeconds(listeningEvents);
    const previousListeningSeconds = sumListeningSeconds(previousListeningEvents);
    const successfulPhrases = voiceSuccessEvents.length;
    const attemptedPhrases = Math.max(voiceAttemptEvents.length, successfulPhrases);
    const accuracyPercent =
      attemptedPhrases > 0 ? Math.round((successfulPhrases / attemptedPhrases) * 100) : 0;

    const audioCompleteCount = listeningEvents.filter((e) => e.eventType === 'audio_complete').length;
    const audioListenCount = listeningEvents.filter((e) => e.eventType === 'audio_listen').length;
    const listeningSessionsStarted = Math.max(audioListenCount, audioCompleteCount);
    const completionRatePercent =
      listeningSessionsStarted > 0
        ? Math.round((audioCompleteCount / listeningSessionsStarted) * 100)
        : 0;

    const activeDays = new Set(events.map((e) => e.createdAt.toISOString().slice(0, 10))).size;
    const listeningDays = new Set(
      listeningEvents.map((e) => e.createdAt.toISOString().slice(0, 10)),
    ).size;

    const weeklyMinutes = this.buildWeeklyMinutes(listeningEvents, daysBack);

    const attemptsByTerm = new Map<string, number>();
    const successesByTerm = new Map<string, number>();
    for (const event of writingSuccessEvents) {
      const term = this.normalizeBonusWord(String(event.payloadJson?.term || ''));
      if (!term) continue;
      successesByTerm.set(term, (successesByTerm.get(term) || 0) + 1);
      attemptsByTerm.set(term, (attemptsByTerm.get(term) || 0) + 1);
    }
    for (const event of writingRevealEvents) {
      const term = this.normalizeBonusWord(String(event.payloadJson?.term || ''));
      if (!term) continue;
      attemptsByTerm.set(term, (attemptsByTerm.get(term) || 0) + 1);
    }

    const vocabularyWords = exposures.map((item: { term: string; exposureCount: number }) => {
      const normalized = this.normalizeBonusWord(item.term);
      const exposureCount = Number(item.exposureCount || 0);
      const attempts = attemptsByTerm.get(normalized) || 0;
      const successes = successesByTerm.get(normalized) || 0;
      // Legacy status kept for older clients; UI now uses attempts/successes.
      let status = 'Review soon';
      if (successes > 0 || learnedTerms.has(normalized)) {
        status = 'Getting stronger';
      } else if (exposureCount >= 3 || attempts > 0) {
        status = 'Practiced';
      } else if (exposureCount >= 1) {
        status = 'In progress';
      }
      const lastPracticedAt = lastPracticedByTerm.get(normalized) || null;
      return {
        word: item.term,
        translationRu: translationByTerm.get(normalized) || '',
        exposureCount,
        attempts,
        successes,
        status,
        lastPracticedAt: lastPracticedAt ? lastPracticedAt.toISOString() : null,
      };
    });

    vocabularyWords.sort((a, b) => {
      if (b.attempts !== a.attempts) return b.attempts - a.attempts;
      if (b.successes !== a.successes) return b.successes - a.successes;
      return b.exposureCount - a.exposureCount;
    });

    const totalWords = vocabularyWords.length;
    const successfulWords = vocabularyWords.filter((w) => w.successes > 0).length;
    const practicedCount = vocabularyWords.filter((w) => w.attempts > 0 || w.exposureCount >= 1).length;
    const gettingStrongerCount = successfulWords;
    const inProgressCount = vocabularyWords.filter((w) => w.attempts === 0 && w.exposureCount >= 1).length;
    const reviewSoonCount = vocabularyWords.filter((w) => w.attempts === 0 && w.exposureCount < 1).length;
    const learnedCount = successfulWords;

    const previousWritingRevealEvents = previousEvents.filter((e) => e.eventType === 'writing_reveal');
    const previousAttempts =
      previousWritingSuccessEvents.length + previousWritingRevealEvents.length;

    const percentDelta = (current: number, previous: number) => {
      if (previous <= 0) {
        return current > 0 ? 100 : 0;
      }
      return Math.round(((current - previous) / previous) * 100);
    };

    const spellingAnswers = writingSuccessEvents.length + writingRevealEvents.length;
    const spellingCorrectPercent =
      spellingAnswers > 0 ? Math.round((writingSuccessEvents.length / spellingAnswers) * 100) : 0;

    const recommendations = this.buildLearningRecommendations(
      vocabularyWords,
      totalListeningSeconds,
      successfulPhrases,
    );

    const frameworks =
      seasons.length > 0
        ? await this.seasonFrameworksRepository.find({
            where: seasons.map((season) => ({ seasonId: season.seasonId })),
          })
        : [];
    const frameworkMap = new Map(frameworks.map((item) => [item.seasonId, item]));
    const choices =
      seasons.length > 0
        ? await this.episodeChoicesRepository.find({
            where: seasons.map((season) => ({ seasonId: season.seasonId })),
            select: ['seasonId'],
          })
        : [];
    const completedBySeason = new Map<string, number>();
    for (const choice of choices) {
      completedBySeason.set(choice.seasonId, (completedBySeason.get(choice.seasonId) || 0) + 1);
    }
    const speakingRows =
      seasons.length > 0
        ? await this.learningEventsRepository
            .createQueryBuilder('event')
            .select('event.season_id', 'seasonId')
            .addSelect('COUNT(*)', 'count')
            .where('event.season_id IN (:...seasonIds)', {
              seasonIds: seasons.map((s) => s.seasonId),
            })
            .andWhere('event.event_type = :eventType', { eventType: 'voice_success' })
            .groupBy('event.season_id')
            .getRawMany()
        : [];
    const speakingBySeason = new Map<string, number>(
      speakingRows.map((row) => [String(row.seasonId), Number(row.count || 0)]),
    );

    const seasonCards = seasons.slice(0, 3).map((season, index) => {
      const framework = frameworkMap.get(season.seasonId);
      const outlineEpisodes = framework?.episodeOutline?.episodes || [];
      const totalEpisodes = outlineEpisodes.length || 96;
      const completedEpisodes = completedBySeason.get(season.seasonId) || 0;
      return {
        seasonId: season.seasonId,
        title: this.getCanonicalSeasonTitle(season, framework),
        coverImageUrl: this.mapStorageUrl(season.seasonSetup?.seasonCoverImageUrl),
        status: this.mapLibraryStatus(season),
        seasonNumber: index + 1,
        completedEpisodes,
        totalEpisodes,
        wordsPracticed: this.countLearnedWords(season),
        speakingCompleted: speakingBySeason.get(season.seasonId) || 0,
      };
    });

    const activeSeason =
      (options.seasonId && seasons.find((s) => s.seasonId === options.seasonId)) ||
      seasons.find((s) => this.mapLibraryStatus(s) === 'active') ||
      seasons[0] ||
      null;

    return {
      ownerUserId,
      range,
      seasonId: options.seasonId || activeSeason?.seasonId || null,
      activeSeasonTitle: activeSeason
        ? this.getCanonicalSeasonTitle(activeSeason, frameworkMap.get(activeSeason.seasonId))
        : null,
      overview: {
        englishAudioListenedMinutes: Math.round(totalListeningSeconds / 60),
        activeLearningDays: activeDays,
        vocabularyLearned: learnedCount,
        vocabularyPracticed: practicedCount,
        speakingSuccessful: successfulPhrases,
      },
      deltas: {
        audioListenedPercent: percentDelta(totalListeningSeconds, previousListeningSeconds),
        speakingSuccessfulPercent: percentDelta(
          successfulPhrases,
          previousVoiceSuccessEvents.length,
        ),
        vocabularyPracticedPercent: percentDelta(spellingAnswers, previousAttempts),
      },
      listening: {
        weeklyMinutes,
        completionRatePercent,
        completedSessions: audioCompleteCount,
        consistencyDays: listeningDays,
        hasActivity: listeningEvents.length > 0,
      },
      speaking: {
        attemptedPhrases,
        successfulPhrases,
        accuracyPercent,
        trend: this.buildSpeakingTrend(voiceAttemptEvents, voiceSuccessEvents, daysBack),
        microphoneAvailable: true,
        nextGoal: recommendations.find((r) => r.type === 'speaking')?.text || null,
        hasActivity: attemptedPhrases > 0,
      },
      vocabulary: {
        learned: learnedCount,
        practiced: practicedCount,
        gettingStronger: gettingStrongerCount,
        inProgress: inProgressCount,
        reviewSoon: reviewSoonCount,
        totalWords,
        successfulWords,
        totalAttempts: spellingAnswers,
        successfulAttempts: writingSuccessEvents.length,
        words: vocabularyWords.slice(0, 20),
        hasActivity: vocabularyWords.length > 0 || spellingAnswers > 0,
      },
      spelling: {
        answers: spellingAnswers,
        correctPercent: spellingCorrectPercent,
        hasActivity: spellingAnswers > 0,
      },
      seasons: seasonCards,
      recommendations,
      listeningTrackingFull: events.some((e) => e.eventType === 'audio_listen'),
    };
  }

  private buildWeeklyMinutes(events: LearningEvent[], daysBack: number) {
    const days: { label: string; minutes: number }[] = [];
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = daysBack - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayEvents = events.filter((e) => e.createdAt.toISOString().slice(0, 10) === key);
      const seconds = dayEvents.reduce((sum, e) => sum + Number(e.payloadJson?.durationSec || 0), 0);
      days.push({ label: labels[d.getDay()], minutes: Math.round(seconds / 60) });
    }
    return days.slice(-7);
  }

  private buildSpeakingTrend(
    attempts: LearningEvent[],
    successes: LearningEvent[],
    daysBack: number,
  ) {
    const trend: { label: string; percent: number }[] = [];
    for (let i = daysBack - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayAttempts = attempts.filter((e) => e.createdAt.toISOString().slice(0, 10) === key).length;
      const daySuccess = successes.filter((e) => e.createdAt.toISOString().slice(0, 10) === key).length;
      trend.push({
        label: key.slice(5),
        percent: dayAttempts > 0 ? Math.round((daySuccess / dayAttempts) * 100) : 0,
      });
    }
    return trend.slice(-7);
  }

  private buildLearningRecommendations(
    words: { word: string; status: string }[],
    listeningSeconds: number,
    speakingSuccess: number,
  ) {
    const recs: { type: string; text: string }[] = [];
    const reviewWord = words.find((w) => w.status === 'In progress' || w.status === 'Review soon');
    if (reviewWord) {
      recs.push({ type: 'vocabulary', text: `Repeat the word "${reviewWord.word}" in today's chapter.` });
    }
    if (listeningSeconds < 600) {
      recs.push({ type: 'listening', text: 'Listen to at least 10 more minutes of English audio this week.' });
    }
    if (speakingSuccess < 3) {
      recs.push({ type: 'speaking', text: 'Practice saying one phrase aloud from the current episode.' });
    }
    return recs.slice(0, 3);
  }

  async getSeasonsForUser(ownerUserId: string) {
    const seasons = await this.seasonsRepository.find({
      where: { ownerUserId },
      order: { updatedAt: 'DESC' },
    });

    if (seasons.length === 0) {
      return [];
    }

    const frameworks = await this.seasonFrameworksRepository.find({
      where: seasons.map((season) => ({ seasonId: season.seasonId })),
    });
    const frameworkMap = new Map(frameworks.map((item) => [item.seasonId, item]));

    return seasons.map((season) => {
      const framework = frameworkMap.get(season.seasonId)?.framework || {};
      return {
        seasonId: season.seasonId,
        childName: season.childProfile?.childName || '',
        theme: season.seasonSetup?.theme || '',
        world: season.seasonSetup?.world || '',
        status: season.status,
        seasonPremise: framework.seasonPremise || '',
        centralProblem: framework.centralProblem || '',
        updatedAt: season.updatedAt,
      };
    });
  }

  private mapAudioUrls(chunks: any[] = []): any[] {
    return chunks.map((chunk) => ({
      ...chunk,
      audioUrl: this.mapStorageUrl(chunk.audioUrl),
    }));
  }

  private mapStorageUrl(url: string | null | undefined): string | null {
    if (!url) {
      return null;
    }

    if (url.startsWith('data:') || url.includes('/storage-proxy?')) {
      return url;
    }

    const key = this.storage.extractKeyFromUrl(url);
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    if (!key) {
      return null;
    }

    return `${backendUrl}/storage-proxy?key=${encodeURIComponent(key)}`;
  }

  private mapIllustrationForResponse(
    illustration: Illustration,
    entry?: { status: string } | null,
  ) {
    const isLocked = entry?.status === 'locked';
    return {
      illustrationId: illustration.illustrationId,
      seasonId: illustration.seasonId,
      episodeId: illustration.episodeId,
      entryType: illustration.entryType,
      title: illustration.title,
      status: illustration.status,
      imageUrl: isLocked ? null : this.mapStorageUrl(illustration.imageUrl),
      promptPayload: isLocked
        ? {
            moment: illustration.promptPayload?.moment,
            episodeNumber: illustration.promptPayload?.episodeNumber,
            episodeTitle: illustration.promptPayload?.episodeTitle,
          }
        : illustration.promptPayload,
      createdAt: illustration.createdAt,
      updatedAt: illustration.updatedAt,
    };
  }

  private mapEpisodeForResponse(episode: Episode) {
    return {
      episodeId: episode.episodeId,
      episodeNumber: episode.episodeNumber,
      miniArcNumber: episode.miniArcNumber,
      title: episode.title,
      chapterText: episode.chapterText,
      speakingPrompt: episode.speakingPrompt || '',
      introOptionsPhrase: episode.introOptionsPhrase,
      highlightedVocabulary: episode.highlightedVocabulary,
      choices: episode.choices,
      storyStateDiff: episode.storyStateDiff,
      illustrationCandidate: episode.illustrationCandidate,
      audioChunks: this.mapAudioUrls(episode.audioChunks),
      generationStatus: episode.generationStatus,
      promptVersion: episode.promptVersion,
      createdAt: episode.createdAt,
      updatedAt: episode.updatedAt,
    };
  }

  private normalizeSpeakingPhraseKey(phraseText: string): string {
    return this.getSpeakableWords(phraseText)
      .join(' ')
      .replace(/'/g, '')
      .trim();
  }

  private getSpeakingPromptCandidates(chapterText: string): string[] {
    const candidates = Array.from(chapterText.matchAll(/(?:"([^"\n]+)"|“([^”\n]+)”)/g))
      .map((match) => (match[1] || match[2] || '').replace(/\s+/g, ' ').trim())
      .filter((candidate) => this.isValidSpeakingPrompt(candidate));
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = this.normalizeSpeakingPhraseKey(candidate);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private isValidSpeakingPrompt(candidate: string): boolean {
    const normalized = candidate.replace(/\s+/g, ' ').trim();
    const words = this.getSpeakableWords(normalized);
    if (words.length < 4 || words.length > 10 || !/[.!?]$/.test(normalized)) {
      return false;
    }

    const incompleteBoundaryWords = new Set([
      'a', 'an', 'and', 'at', 'because', 'but', 'for', 'from', 'if', 'in', 'into', 'of', 'on', 'or', 'so', 'the', 'then', 'to', 'with', 'when',
    ]);
    return !incompleteBoundaryWords.has(words[0]) && !incompleteBoundaryWords.has(words[words.length - 1]);
  }

  private pickUniqueSpeakingPrompt(
    chapterText: string,
    requestedPrompt: string,
    usedPhraseKeys: Set<string>,
  ): string | null {
    const chapterCandidates = this.getSpeakingPromptCandidates(chapterText);
    const requestedKey = this.normalizeSpeakingPhraseKey(requestedPrompt);
    const requestedCandidate = chapterCandidates.find(
      (candidate) => this.normalizeSpeakingPhraseKey(candidate) === requestedKey,
    );
    const candidates = [requestedCandidate, ...chapterCandidates].filter((candidate): candidate is string => Boolean(candidate));
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const key = this.normalizeSpeakingPhraseKey(candidate);
      if (!key || seen.has(key) || usedPhraseKeys.has(key)) {
        continue;
      }
      seen.add(key);
      return candidate;
    }

    return null;
  }

  private async getUsedSpeakingPhrases(
    seasonId: string,
    excludedPreparedEpisodeId?: string,
  ): Promise<string[]> {
    const episodes = await this.episodesRepository.find({ where: { seasonId } });
    const preparedEpisodes = await this.preparedEpisodesRepository.find({ where: { seasonId } });
    const phrases: string[] = [];
    const seen = new Set<string>();

    const addPhrase = (value: unknown, chapterText?: string) => {
      const phrase = String(value || '').trim();
      const key = this.normalizeSpeakingPhraseKey(phrase);
      if (!phrase || !key || seen.has(key)) {
        return;
      }
      seen.add(key);
      phrases.push(phrase);
    };

    for (const episode of episodes) {
      addPhrase(episode.speakingPrompt);
    }

    for (const prepared of preparedEpisodes) {
      if (prepared.preparedEpisodeId === excludedPreparedEpisodeId || prepared.status === 'used' || prepared.status === 'failed' || prepared.status === 'cancelled') {
        continue;
      }
      const content = prepared.payload?.episodeContent || {};
      addPhrase(content.speakingPrompt);
    }

    return phrases;
  }

  private async ensureUniqueSpeakingPrompt(
    seasonId: string,
    episodeContent: Record<string, any>,
    excludedPreparedEpisodeId?: string,
  ): Promise<Record<string, any>> {
    const usedPhrases = await this.getUsedSpeakingPhrases(seasonId, excludedPreparedEpisodeId);
    const usedPhraseKeys = new Set(usedPhrases.map((phrase) => this.normalizeSpeakingPhraseKey(phrase)));
    const speakingPrompt = this.pickUniqueSpeakingPrompt(
      String(episodeContent.chapterText || ''),
      String(episodeContent.speakingPrompt || ''),
      usedPhraseKeys,
    );

    if (!speakingPrompt) {
      throw new Error(`No unique speaking phrase available for season ${seasonId}`);
    }

    return {
      ...episodeContent,
      speakingPrompt,
      speakingPhraseKey: this.normalizeSpeakingPhraseKey(speakingPrompt),
    };
  }

  private getSpeakableWords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private speechMatchesTarget(targetPhrase: string, transcript: string): boolean {
    const targetWords = this.getSpeakableWords(targetPhrase);
    const spokenWords = this.getSpeakableWords(transcript);
    if (targetWords.length === 0 || spokenWords.length === 0) {
      return false;
    }

    let spokenIndex = 0;
    let matchedCount = 0;

    for (const targetWord of targetWords) {
      while (spokenIndex < spokenWords.length && spokenWords[spokenIndex] !== targetWord) {
        spokenIndex += 1;
      }
      if (spokenIndex < spokenWords.length && spokenWords[spokenIndex] === targetWord) {
        matchedCount += 1;
        spokenIndex += 1;
      }
    }

    return matchedCount / targetWords.length >= 0.75;
  }

  async getSeason(
    seasonId: string,
    options: { reconcileCurrentEpisodeMedia?: boolean; episodeNumber?: number } = {},
  ) {

    let season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }
    season = await this.ensureStoryStateUsesCanonicalProtagonist(season);

    const framework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
    if (!framework) {
      throw new Error('Season framework not found');
    }

    const hero = await this.heroesRepository.findOne({ where: { seasonId } });
    const currentEpisode =
      (await this.episodesRepository.findOne({
        where: { seasonId, episodeNumber: season.currentEpisodeNumber },
      })) ||
      (await this.episodesRepository.findOne({
        where: { seasonId },
        order: { episodeNumber: 'DESC' },
      }));

    const focusEpisodeNumber =
      options.episodeNumber && options.episodeNumber > 0
        ? options.episodeNumber
        : season.currentEpisodeNumber;

    let focusEpisode =
      (await this.episodesRepository.findOne({
        where: { seasonId, episodeNumber: focusEpisodeNumber },
      })) ||
      currentEpisode;

    // Intro audio repair only when the reader is actually on episode 1.
    if (focusEpisode?.episodeNumber === 1 && hero) {
      focusEpisode = await this.ensureStoryIntroAudioChunk(
        season,
        hero,
        framework.framework || {},
        focusEpisode,
      );
    }

    // Current-episode recovery is user-triggered. The background worker must
    // not repeatedly probe crystal-gated illustrations for every season.
    if (options.reconcileCurrentEpisodeMedia) {
      await this.enqueueMissingEpisodeTtsJobs(seasonId, focusEpisodeNumber);
      await this.enqueueMissingEpisodeIllustrationJobs(seasonId, focusEpisodeNumber);
    }

    const focusEpisodeId = focusEpisode?.episodeId || null;
    const relatedEpisodeIds = Array.from(
      new Set([focusEpisodeId, currentEpisode?.episodeId].filter(Boolean) as string[]),
    );

    const generationJobs = await this.generationJobsRepository.find({
      where: {
        seasonId,
        status: In(['pending', 'processing']),
      },
      order: { createdAt: 'ASC' },
      take: 40,
    });
    // Creating UI needs recent failures; the reader does not need historical job noise.
    const creationInProgress = !['episode_ready', 'season_complete'].includes(season.status);
    const failedJobs = creationInProgress
      ? await this.generationJobsRepository.find({
          where: { seasonId, status: 'failed' },
          order: { createdAt: 'DESC' },
          take: 20,
        })
      : [];
    const relevantJobs = [...generationJobs, ...failedJobs].filter((job) => {
      if (creationInProgress) {
        return true;
      }
      if (!relatedEpisodeIds.length) {
        return true;
      }
      if (job.episodeId && relatedEpisodeIds.includes(job.episodeId)) {
        return true;
      }
      const payloadEpisodeId = String(job.payload?.episodeId || '');
      if (payloadEpisodeId && relatedEpisodeIds.includes(payloadEpisodeId)) {
        return true;
      }
      const payloadEpisodeNumber = Number(
        job.payload?.nextEpisodeNumber ||
          job.payload?.promptPayload?.episodeNumber ||
          job.payload?.episodeNumber ||
          0,
      );
      return (
        payloadEpisodeNumber === focusEpisodeNumber ||
        payloadEpisodeNumber === season.currentEpisodeNumber
      );
    });

    const selectedChoices = await this.episodeChoicesRepository.find({
      where: {
        seasonId,
        ...(focusEpisodeNumber
          ? { episodeNumber: In([focusEpisodeNumber, season.currentEpisodeNumber]) }
          : {}),
      },
      order: { createdAt: 'ASC' },
      select: ['choiceRecordId', 'episodeId', 'episodeNumber', 'choiceId', 'createdAt'],
    });
    const crystalWallet = await this.getOrCreateCrystalWallet(season.ownerUserId, seasonId);

    const storybookEntries = focusEpisodeId
      ? await this.storybookEntriesRepository.find({
          where: { seasonId, episodeId: focusEpisodeId },
          order: { createdAt: 'ASC' },
        })
      : [];
    const illustrationIds = storybookEntries
      .map((entry) => entry.illustrationId)
      .filter(Boolean) as string[];
    const illustrations = illustrationIds.length
      ? await this.illustrationsRepository.find({
          where: { illustrationId: In(illustrationIds) },
        })
      : focusEpisodeId
        ? await this.illustrationsRepository.find({
            where: { seasonId, episodeId: focusEpisodeId },
            order: { createdAt: 'ASC' },
          })
        : [];
    const storybookEntryByIllustrationId = new Map(
      storybookEntries
        .filter((entry) => entry.illustrationId)
        .map((entry) => [entry.illustrationId as string, entry]),
    );

    const preparedNext =
      currentEpisode && focusEpisodeNumber === season.currentEpisodeNumber
        ? await this.preparedEpisodesRepository.find({
            where: { seasonId, sourceEpisodeId: currentEpisode.episodeId },
            order: { createdAt: 'ASC' },
          })
        : [];
    const bonusPracticeState = await this.getOrCreateBonusPracticeState(season);
    const heroDraftDefaults = hero?.heroPreferences
      ? hero.heroPreferences
      : await this.getOrCreateHeroDraftDefaults(season, framework.framework, framework.seasonBible);
    const bonusPracticeSummary = await this.buildBonusPracticeSummary(season, bonusPracticeState, 'story');

    void this.ensureSeasonVisualAssetsInBackground(seasonId);

    const frameworkLite = {
      seasonPremise: framework.framework?.seasonPremise || null,
      centralProblem: framework.framework?.centralProblem || null,
      title: framework.framework?.title || null,
    };
    const outlineEpisodes = Array.isArray(framework.episodeOutline?.episodes)
      ? framework.episodeOutline.episodes.map((item: any) => ({
          episodeNumber: item.episodeNumber,
          title: item.title || null,
        }))
      : [];

    const episodesForResponse = [];
    if (focusEpisode) {
      episodesForResponse.push(this.mapEpisodeForResponse(focusEpisode));
    }
    if (
      currentEpisode &&
      focusEpisodeNumber === season.currentEpisodeNumber &&
      (!focusEpisode || currentEpisode.episodeId !== focusEpisode.episodeId)
    ) {
      // Keep current episode available for "continue" / hasNext without all history.
      episodesForResponse.push(this.mapEpisodeForResponse(currentEpisode));
    } else if (
      currentEpisode &&
      focusEpisode &&
      currentEpisode.episodeId !== focusEpisode.episodeId
    ) {
      // Reader only needs current episode metadata for hasNext / progress, not full text.
      episodesForResponse.push({
        episodeId: currentEpisode.episodeId,
        episodeNumber: currentEpisode.episodeNumber,
        miniArcNumber: currentEpisode.miniArcNumber,
        title: currentEpisode.title,
        chapterText: '',
        speakingPrompt: '',
        introOptionsPhrase: '',
        highlightedVocabulary: [],
        choices: [],
        storyStateDiff: null,
        illustrationCandidate: null,
        audioChunks: [],
        generationStatus: currentEpisode.generationStatus,
        promptVersion: currentEpisode.promptVersion,
        createdAt: currentEpisode.createdAt,
        updatedAt: currentEpisode.updatedAt,
      });
    }

    return {
      seasonId: season.seasonId,
      ownerUserId: season.ownerUserId,
      childProfile: season.childProfile,
      seasonSetup: {
        ...(season.seasonSetup || {}),
        seasonCoverImageUrl: this.mapStorageUrl(season.seasonSetup?.seasonCoverImageUrl),
      },
      status: season.status,
      promptVersion: season.promptVersion,
      currentEpisodeNumber: season.currentEpisodeNumber,
      currentMiniArc: season.currentMiniArc,
      storyState: {
        wizardCompletedAt: season.storyState?.wizardCompletedAt || null,
        pendingHeroPreferences: season.storyState?.pendingHeroPreferences || null,
        seasonProgress: season.storyState?.seasonProgress || null,
      },
      bonusPracticeSummary: bonusPracticeSummary.season,
      framework: frameworkLite,
      seasonBible: null,
      episodeOutline: { episodes: outlineEpisodes },
      generationStatus: framework.generationStatus,
      focusEpisodeNumber,
      hero: hero
        ? {
            heroProfile: hero.heroProfile,
            heroVisualBrief: hero.heroVisualBrief,
            // Reference art is only needed for episode-1 intro / hero setup UI.
            heroReferenceImageUrl:
              focusEpisodeNumber === 1 ||
              season.status === 'framework_ready' ||
              season.status === 'hero_ready' ||
              season.status === 'setup_pending'
                ? this.mapStorageUrl(hero.heroReferenceImageUrl)
                : null,
            generationStatus: hero.generationStatus,
            heroPreferences: hero.heroPreferences,
            promptVersion: hero.promptVersion,
          }
        : null,
      heroDraftDefaults,
      currentEpisode: currentEpisode
        ? focusEpisodeNumber === season.currentEpisodeNumber ||
          focusEpisode?.episodeId === currentEpisode.episodeId
          ? this.mapEpisodeForResponse(currentEpisode)
          : {
              episodeId: currentEpisode.episodeId,
              episodeNumber: currentEpisode.episodeNumber,
              miniArcNumber: currentEpisode.miniArcNumber,
              title: currentEpisode.title,
              chapterText: '',
              speakingPrompt: '',
              introOptionsPhrase: '',
              highlightedVocabulary: [],
              choices: [],
              storyStateDiff: null,
              illustrationCandidate: null,
              audioChunks: [],
              generationStatus: currentEpisode.generationStatus,
              promptVersion: currentEpisode.promptVersion,
              createdAt: currentEpisode.createdAt,
              updatedAt: currentEpisode.updatedAt,
            }
        : null,
      episodes: episodesForResponse,
      generationJobs: relevantJobs.map((job) => ({
        jobId: job.jobId,
        jobType: job.jobType,
        status: job.status,
        payload: {
          episodeId: job.payload?.episodeId || null,
          illustrationId: job.payload?.illustrationId || null,
          storybookEntryId: job.payload?.storybookEntryId || null,
          nextEpisodeNumber: job.payload?.nextEpisodeNumber || null,
          promptPayload: job.payload?.promptPayload
            ? {
                episodeNumber: job.payload.promptPayload.episodeNumber,
                episodeTitle: job.payload.promptPayload.episodeTitle,
              }
            : null,
          metadata: job.payload?.metadata
            ? {
                chunkId: job.payload.metadata.chunkId,
                episodeId: job.payload.metadata.episodeId,
              }
            : null,
        },
        result: null,
        error: job.error,
        promptVersion: job.promptVersion,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })),
      selectedChoices: selectedChoices.map((choice) => ({
        choiceRecordId: choice.choiceRecordId,
        episodeId: choice.episodeId,
        episodeNumber: choice.episodeNumber,
        choiceId: choice.choiceId,
        createdAt: choice.createdAt,
      })),
      crystalWallet: {
        walletId: crystalWallet.walletId,
        balance: crystalWallet.balance,
      },
      storybook: {
        entries: storybookEntries.map((entry) => this.mapStorybookEntryForResponse(entry, illustrations)),
        illustrations: illustrations.map((illustration) =>
          this.mapIllustrationForResponse(illustration, storybookEntryByIllustrationId.get(illustration.illustrationId)),
        ),
      },
      preparedNext: preparedNext.map((item) => ({
        preparedEpisodeId: item.preparedEpisodeId,
        sourceEpisodeId: item.sourceEpisodeId,
        sourceEpisodeNumber: item.sourceEpisodeNumber,
        choiceId: item.choiceId,
        nextEpisodeNumber: item.nextEpisodeNumber,
        status: item.status,
        payload: item.payload?.preparedAudioChunks
          ? { ...item.payload, preparedAudioChunks: this.mapAudioUrls(item.payload.preparedAudioChunks) }
          : item.payload,
        promptVersion: item.promptVersion,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      createdAt: season.createdAt,
      updatedAt: season.updatedAt,
    };
  }

  async getBonusPracticeSummary(seasonId: string, origin: BonusPracticeOrigin = 'story') {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const bonusState = await this.getOrCreateBonusPracticeState(season);
    return this.buildBonusPracticeSummary(season, bonusState, origin);
  }

  async getSpeakingPractice(seasonId: string, origin: BonusPracticeOrigin = 'story') {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const currentEpisode = await this.episodesRepository.findOne({
      where: { seasonId, episodeNumber: season.currentEpisodeNumber },
    });
    const bonusState = await this.getOrCreateBonusPracticeState(season);
    const voiceLedger = await this.crystalLedgerRepository.find({
      where: {
        ownerUserId: season.ownerUserId,
        seasonId,
        reason: In(['voice_attempt', 'bonus_speaking']),
      },
    });
    const pendingQueue = await this.getPendingSpeakingQueueForSeason(season, bonusState, voiceLedger);
    const speakingSingle = this.getCurrentEpisodeSpeakingAvailability(season, currentEpisode, pendingQueue, voiceLedger);
    const speakingRecap = this.buildRecapAvailability(season, pendingQueue, bonusState.storyRecapState || {}, origin);

    if (speakingRecap.pendingCount >= BONUS_RECAP_SIZE && (origin === 'home' || speakingRecap.available)) {
      return {
        origin,
        type: 'speaking_recap' as BonusPracticeType,
        rewardPerSuccess: 1,
        maxReward: BONUS_RECAP_SIZE,
        pendingCount: speakingRecap.pendingCount,
        items: speakingRecap.items.map((item, index) => ({
          itemId: item.itemId,
          phraseText: item.phraseText,
          episodeId: item.episodeId,
          episodeNumber: item.episodeNumber,
          stepIndex: index,
        })),
      };
    }

    if (origin === 'story' && speakingSingle.available) {
      return {
        origin,
        type: 'speaking_single' as BonusPracticeType,
        rewardPerSuccess: 1,
        maxReward: 1,
        phraseText: speakingSingle['phraseText'],
        episodeId: speakingSingle['episodeId'],
        episodeNumber: speakingSingle['episodeNumber'],
      };
    }

    return {
      origin,
      type: null,
      available: false,
      pendingCount: speakingRecap.pendingCount,
      reason: 'not_available',
    };
  }

  async submitSpeakingPracticeAttempt(
    seasonId: string,
    payload: {
      origin?: BonusPracticeOrigin;
      itemId?: string;
      episodeId?: string;
      targetPhrase?: string;
      transcript?: string;
    },
  ) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const bonusState = await this.getOrCreateBonusPracticeState(season);
    const voiceLedger = await this.crystalLedgerRepository.find({
      where: {
        ownerUserId: season.ownerUserId,
        seasonId,
        reason: In(['voice_attempt', 'bonus_speaking']),
      },
    });
    const pendingQueue = await this.getPendingSpeakingQueueForSeason(season, bonusState, voiceLedger);
    const queueItem = payload.itemId ? pendingQueue.find((item) => item.itemId === payload.itemId) || null : null;
    const episodeId = String(payload.episodeId || queueItem?.episodeId || '').trim();
    const episode = episodeId
      ? await this.episodesRepository.findOne({ where: { seasonId, episodeId } })
      : null;
    const targetPhrase = String(payload.targetPhrase || queueItem?.phraseText || episode?.speakingPrompt || '').trim();
    const transcript = String(payload.transcript || '').trim();

    if (!targetPhrase || !transcript) {
      return {
        success: false,
        status: 'missing_input',
        transcript,
        targetPhrase,
        crystalsAwarded: 0,
      };
    }

    if (!this.speechMatchesTarget(targetPhrase, transcript)) {
      await this.recordLearningEvent(seasonId, {
        episodeId: episode?.episodeId || null,
        eventType: 'voice_attempt',
        payload: { targetPhrase, transcript: transcript.slice(0, 200), matched: false, origin: payload.origin || 'story' },
      });
      return {
        success: false,
        status: 'not_matched',
        transcript,
        targetPhrase,
        crystalsAwarded: 0,
      };
    }

    const existingVoiceAttempts = await this.crystalLedgerRepository.find({
      where: {
        ownerUserId: season.ownerUserId,
        seasonId,
        reason: In(['voice_attempt', 'bonus_speaking']),
      },
    });
    const alreadyRewarded = existingVoiceAttempts.some(
      (entry) => this.normalizeSpeakingPhraseKey(String(entry.metadata?.targetPhrase || '')) === this.normalizeSpeakingPhraseKey(targetPhrase),
    );
    if (alreadyRewarded) {
      return {
        success: true,
        status: 'already_awarded',
        transcript,
        targetPhrase,
        crystalsAwarded: 0,
      };
    }

    await this.creditCrystals(season.ownerUserId, seasonId, 1, 'bonus_speaking', {
      episodeId,
      targetPhrase,
      transcript: transcript.slice(0, 200),
      itemId: queueItem?.itemId || null,
      origin: payload.origin || 'story',
    });

    await this.recordLearningEvent(seasonId, {
      episodeId,
      eventType: 'voice_success',
      payload: { targetPhrase, matched: true, origin: payload.origin || 'story' },
    });

    if (queueItem) {
      bonusState.skippedSpeakingQueue = pendingQueue
        .filter((item) => item.itemId !== queueItem.itemId)
        .map((item) => ({ ...item }));
      if (payload.origin === 'story') {
        bonusState.storyRecapState = {
          ...(bonusState.storyRecapState || {}),
          lastStoryRecapEpisodeNumber: season.currentEpisodeNumber,
        };
      }
      await this.saveBonusPracticeState(bonusState);
    }

    return {
      success: true,
      status: 'awarded',
      transcript,
      targetPhrase,
      crystalsAwarded: 1,
      summary: await this.getBonusPracticeSummary(seasonId, payload.origin || 'story'),
      season: await this.getSeason(seasonId),
    };
  }

  async skipSpeakingPractice(
    seasonId: string,
    payload: {
      origin?: BonusPracticeOrigin;
      type?: string;
      itemId?: string;
      episodeId?: string;
      targetPhrase?: string;
    },
  ) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const bonusState = await this.getOrCreateBonusPracticeState(season);
    const voiceLedger = await this.crystalLedgerRepository.find({
      where: {
        ownerUserId: season.ownerUserId,
        seasonId,
        reason: In(['voice_attempt', 'bonus_speaking']),
      },
    });
    const pendingQueue = await this.getPendingSpeakingQueueForSeason(season, bonusState, voiceLedger);
    const now = new Date().toISOString();

    if (payload.type === 'speaking_single') {
      const episodeId = String(payload.episodeId || '').trim();
      const targetPhrase = String(payload.targetPhrase || '').trim();
      const episode = episodeId
        ? await this.episodesRepository.findOne({ where: { seasonId, episodeId } })
        : null;
      const episodeNumber = Number(episode?.episodeNumber || season.currentEpisodeNumber);
      const phraseText = targetPhrase || episode?.speakingPrompt || '';
      const exists = pendingQueue.some(
        (item) => this.normalizeSpeakingPhraseKey(item.phraseText) === this.normalizeSpeakingPhraseKey(phraseText),
      );
      if (episodeId && phraseText && !exists) {
        bonusState.skippedSpeakingQueue = [
          ...pendingQueue,
          {
            itemId: uuidv4(),
            phraseText,
            episodeId,
            episodeNumber,
            status: 'pending',
            createdAt: now,
          },
        ];
        await this.saveBonusPracticeState(bonusState);
      }
    } else if (payload.type === 'speaking_recap' && payload.origin === 'story') {
      bonusState.storyRecapState = {
        ...(bonusState.storyRecapState || {}),
        lastStoryRecapEpisodeNumber: season.currentEpisodeNumber,
      };
      await this.saveBonusPracticeState(bonusState);
    }

    return {
      closed: true,
      summary: await this.getBonusPracticeSummary(seasonId, payload.origin || 'story'),
    };
  }

  private buildWritingChallengeWordPool(episodes: Episode[]): WritingChallengeWord[] {
    const pool: WritingChallengeWord[] = [];
    const seen = new Set<string>();

    for (const episode of episodes) {
      for (const vocab of Array.isArray(episode.highlightedVocabulary) ? episode.highlightedVocabulary : []) {
        const term = String(vocab?.term || '').trim();
        const translationRu = String(vocab?.translationRu || '').trim();
        const normalized = this.normalizeBonusWord(term);
        if (!normalized || normalized.length < 2 || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        pool.push({
          term,
          translationRu,
          meaningInContext: String(vocab?.meaningInContext || '').trim(),
          episodeId: episode.episodeId,
          episodeNumber: episode.episodeNumber,
        });
      }
    }

    return pool;
  }

  private async createWritingChallenge(season: Season, bonusState: BonusPracticeState) {
    const writingState = this.normalizeWritingState(bonusState.writingState);
    const recentTerms = new Set(writingState.recentTerms || []);
    const pool = await this.getWritingPracticeWords(season, writingState);
    const preferred = pool.filter((item) => item.isReview || !recentTerms.has(this.normalizeBonusWord(item.word.term)));
    const selected = [...preferred, ...pool]
      .filter((item, index, arr) => arr.findIndex((candidate) => this.normalizeBonusWord(candidate.word.term) === this.normalizeBonusWord(item.word.term)) === index)
      .slice(0, WRITING_PRACTICE_WORD_COUNT);

    if (selected.length < WRITING_PRACTICE_WORD_COUNT) {
      throw new Error('Not enough vocabulary to start writing practice');
    }

    const now = new Date().toISOString();
    const challenge: WritingChallengeSnapshot = {
      challengeId: uuidv4(),
      status: 'active',
      words: selected.map(({ word }) => word),
      progress: selected.map(({ word, progress }) => ({
        term: word.term,
        hintsUsed: [],
        attempts: 0,
        reward: 0,
        rewardEligible: !progress.firstRewardAwarded,
        completed: false,
        correct: false,
        revealed: false,
      })),
      currentIndex: 0,
      totalReward: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    bonusState.writingState = {
      ...writingState,
      activeChallenge: challenge,
    };
    await this.saveBonusPracticeState(bonusState);
    return challenge;
  }

  async getWritingPractice(seasonId: string, origin: BonusPracticeOrigin = 'story') {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const bonusState = await this.getOrCreateBonusPracticeState(season);
    const writingState = this.normalizeWritingState(bonusState.writingState);
    let challenge = writingState.activeChallenge || null;
    const eligibility = await this.getWritingEligibility(season, writingState, origin);

    if (!challenge) {
      if (!eligibility.available) {
        return {
          origin,
          type: 'spelling_test' as BonusPracticeType,
          available: false,
          wordCount: WRITING_PRACTICE_WORD_COUNT,
          maxReward: WRITING_PRACTICE_WORD_COUNT,
        };
      }
      challenge = await this.createWritingChallenge(season, bonusState);
    }

    return {
      origin,
      type: 'spelling_test' as BonusPracticeType,
      available: true,
      wordCount: WRITING_PRACTICE_WORD_COUNT,
      maxReward: this.mapWritingChallengeForResponse(challenge)?.maxReward ?? WRITING_PRACTICE_WORD_COUNT,
      challenge: this.mapWritingChallengeForResponse(challenge),
    };
  }

  async markWritingPracticePromptShown(seasonId: string) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const bonusState = await this.getOrCreateBonusPracticeState(season);
    const writingState = this.normalizeWritingState(bonusState.writingState);
    const eligibility = await this.getWritingEligibility(season, writingState, 'story');

    if (!eligibility.storyPromptAvailable) {
      return { recorded: false, episodeNumber: season.currentEpisodeNumber };
    }

    bonusState.writingState = {
      ...writingState,
      lastPromptedEpisodeNumber: season.currentEpisodeNumber,
    };
    await this.saveBonusPracticeState(bonusState);

    return { recorded: true, episodeNumber: season.currentEpisodeNumber };
  }

  private getWritingActiveChallenge(state: BonusPracticeState): WritingChallengeSnapshot {
    const writingState = this.normalizeWritingState(state.writingState);
    const challenge = writingState.activeChallenge || null;
    if (!challenge || challenge.status !== 'active') {
      throw new Error('Writing practice is not active');
    }
    return challenge;
  }

  async submitWritingPracticeAttempt(
    seasonId: string,
    payload: {
      answer?: string;
      mode?: 'audio' | 'translation';
    },
  ) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const bonusState = await this.getOrCreateBonusPracticeState(season);
    const writingState = this.normalizeWritingState(bonusState.writingState);
    const challenge = this.getWritingActiveChallenge(bonusState);
    const currentWord = challenge.words[challenge.currentIndex];
    const currentProgress = challenge.progress[challenge.currentIndex];
    const normalizedAnswer = this.normalizeBonusWord(payload.answer || '');
    const normalizedTarget = this.normalizeBonusWord(currentWord.term);

    currentProgress.attempts += 1;
    if (normalizedAnswer !== normalizedTarget) {
      challenge.updatedAt = new Date().toISOString();
      bonusState.writingState = { ...writingState, activeChallenge: challenge };
      await this.saveBonusPracticeState(bonusState);
      return {
        correct: false,
        awarded: 0,
        challenge: this.mapWritingChallengeForResponse(challenge),
      };
    }

    const termKey = this.normalizeBonusWord(currentWord.term);
    const previousTermProgress = writingState.termProgress?.[termKey] || this.getDefaultWritingTermProgress();
    // A correct retry can still earn the one-time reward, but only a first-try
    // answer advances the spaced-repetition streak.
    const canStrengthen = currentProgress.hintsUsed.length === 0 && currentProgress.attempts === 1;
    const nextCorrectStreak = canStrengthen ? previousTermProgress.correctStreak + 1 : 0;
    const reward = currentProgress.hintsUsed.length === 0 && Boolean(currentProgress.rewardEligible ?? true) ? 1 : 0;
    const nextTermProgress: WritingTermProgress = {
      correctStreak: nextCorrectStreak,
      firstRewardAwarded: previousTermProgress.firstRewardAwarded || reward > 0,
      lastPracticedEpisodeNumber: season.currentEpisodeNumber,
      nextReviewEpisodeNumber: canStrengthen && nextCorrectStreak < 3
        ? season.currentEpisodeNumber + this.getWritingReviewDelay(nextCorrectStreak)
        : season.currentEpisodeNumber + 1,
      mastered: canStrengthen && nextCorrectStreak >= 3,
    };
    currentProgress.reward = reward;
    currentProgress.completed = true;
    currentProgress.correct = true;
    challenge.totalReward += reward;

    await this.recordLearningEvent(seasonId, {
      episodeId: currentWord.episodeId || null,
      eventType: 'writing_success',
      payload: {
        term: currentWord.term,
        challengeId: challenge.challengeId,
        hintsUsed: currentProgress.hintsUsed,
        practiceEpisodeNumber: season.currentEpisodeNumber,
        review: previousTermProgress.firstRewardAwarded,
      },
    });

    if (reward > 0) {
      await this.creditCrystals(season.ownerUserId, seasonId, reward, 'bonus_writing_word', {
        challengeId: challenge.challengeId,
        term: currentWord.term,
        episodeId: currentWord.episodeId || null,
      });
    }

    challenge.currentIndex += 1;
    challenge.updatedAt = new Date().toISOString();

    const nextWritingState: WritingState = {
      ...writingState,
      termProgress: {
        ...(writingState.termProgress || {}),
        [termKey]: nextTermProgress,
      },
    };

    if (challenge.currentIndex >= challenge.words.length) {
      challenge.status = 'completed';
      challenge.completedAt = new Date().toISOString();
      bonusState.writingState = {
        ...nextWritingState,
        activeChallenge: null,
        lastEligibleEpisodeNumber: season.currentEpisodeNumber,
        recentTerms: challenge.words
          .map((word) => this.normalizeBonusWord(word.term))
          .concat(writingState.recentTerms || [])
          .slice(0, 12),
      };
    } else {
      bonusState.writingState = { ...nextWritingState, activeChallenge: challenge };
    }

    await this.saveBonusPracticeState(bonusState);

    return {
      correct: true,
      awarded: reward,
      completed: challenge.status === 'completed',
      challenge: this.mapWritingChallengeForResponse(challenge),
      summary: await this.getBonusPracticeSummary(seasonId, 'story'),
    };
  }

  async requestWritingPracticeHint(seasonId: string, hintType?: 'first_letter' | 'translation') {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const bonusState = await this.getOrCreateBonusPracticeState(season);
    const writingState = this.normalizeWritingState(bonusState.writingState);
    const challenge = this.getWritingActiveChallenge(bonusState);
    const currentWord = challenge.words[challenge.currentIndex];
    const currentProgress = challenge.progress[challenge.currentIndex];
    const resolvedHintType = hintType === 'translation' ? 'translation' : 'first_letter';

    if (!currentProgress.hintsUsed.includes(resolvedHintType)) {
      currentProgress.hintsUsed.push(resolvedHintType);
    }
    challenge.updatedAt = new Date().toISOString();
    bonusState.writingState = { ...writingState, activeChallenge: challenge };
    await this.saveBonusPracticeState(bonusState);

    return {
      hintType: resolvedHintType,
      hintValue: resolvedHintType === 'translation' ? currentWord.translationRu : currentWord.term.charAt(0),
      challenge: this.mapWritingChallengeForResponse(challenge),
    };
  }

  async revealWritingPracticeAnswer(seasonId: string) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const bonusState = await this.getOrCreateBonusPracticeState(season);
    const writingState = this.normalizeWritingState(bonusState.writingState);
    const challenge = this.getWritingActiveChallenge(bonusState);
    const currentProgress = challenge.progress[challenge.currentIndex];
    const currentWord = challenge.words[challenge.currentIndex];

    currentProgress.completed = true;
    currentProgress.correct = false;
    currentProgress.revealed = true;
    currentProgress.reward = 0;
    challenge.currentIndex += 1;
    challenge.updatedAt = new Date().toISOString();

    const termKey = this.normalizeBonusWord(currentWord.term);
    const nextWritingState: WritingState = {
      ...writingState,
      termProgress: {
        ...(writingState.termProgress || {}),
        [termKey]: {
          ...this.getDefaultWritingTermProgress(),
          firstRewardAwarded: Boolean(writingState.termProgress?.[termKey]?.firstRewardAwarded),
          lastPracticedEpisodeNumber: season.currentEpisodeNumber,
          nextReviewEpisodeNumber: season.currentEpisodeNumber + 1,
        },
      },
    };

    if (challenge.currentIndex >= challenge.words.length) {
      challenge.status = 'completed';
      challenge.completedAt = new Date().toISOString();
      bonusState.writingState = {
        ...nextWritingState,
        activeChallenge: null,
        lastEligibleEpisodeNumber: season.currentEpisodeNumber,
        recentTerms: challenge.words
          .map((word) => this.normalizeBonusWord(word.term))
          .concat(writingState.recentTerms || [])
          .slice(0, 12),
      };
    } else {
      bonusState.writingState = { ...nextWritingState, activeChallenge: challenge };
    }

    await this.recordLearningEvent(seasonId, {
      episodeId: currentWord.episodeId || null,
      eventType: 'writing_reveal',
      payload: { term: currentWord.term, practiceEpisodeNumber: season.currentEpisodeNumber },
    });
    await this.saveBonusPracticeState(bonusState);

    return {
      revealed: currentWord.term,
      completed: challenge.status === 'completed',
      challenge: this.mapWritingChallengeForResponse(challenge),
    };
  }

  async skipWritingPractice(seasonId: string) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    return {
      closed: true,
      summary: await this.getBonusPracticeSummary(seasonId, 'story'),
    };
  }

  async generateFirstEpisode(seasonId: string) {

    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
    if (!seasonFramework) {
      throw new Error('Season framework not found');
    }

    const existingEpisode = await this.episodesRepository.findOne({ where: { seasonId, episodeNumber: 1 } });
    if (existingEpisode) {
      return this.getSeason(seasonId);
    }

    const hero = await this.heroesRepository.findOne({ where: { seasonId } });
    const outlineItem =
      seasonFramework.episodeOutline?.episodes?.find((episode) => episode.episodeNumber === 1) ||
      seasonFramework.episodeOutline?.episodes?.[0] ||
      {};
    const episodeContent = await this.generateEpisodeContent(
      season,
      seasonFramework.framework,
      seasonFramework.seasonBible,
      hero,
      outlineItem,
      season.storyState || {},
      null,
      null,
    );
    await this.syncSeasonCharactersFromEpisode(
      seasonId,
      seasonFramework.seasonBible || {},
      hero,
      episodeContent,
    );
    const canonicalEpisodeContent = await this.canonicalizeEpisodeContentSceneCharacters(seasonId, episodeContent);
    const storyIntroText = hero
      ? this.buildStoryIntroSpeechText(hero, season.seasonSetup || {}, seasonFramework.framework || {})
      : null;
    const createdEpisode = await this.createEpisodeRecord(
      seasonId,
      1,
      outlineItem,
      canonicalEpisodeContent,
      undefined,
      season.childProfile?.languageLevel,
      storyIntroText,
    );
    await this.prepareEpisodeIllustration(seasonId, createdEpisode, hero);

    season.currentEpisodeNumber = createdEpisode.episodeNumber;
    season.currentMiniArc = createdEpisode.miniArcNumber;
    season.status = 'episode_ready';
    season.updatedAt = new Date();
    await this.seasonsRepository.save(season);
    await this.enqueuePreparedNextEpisodeJobs(
      season,
      seasonFramework.framework,
      seasonFramework.seasonBible,
      hero,
      createdEpisode,
    );

    return this.getSeason(seasonId);
  }

  async applyEpisodeChoice(seasonId: string, episodeId: string, choiceId: string) {
    this.logPipelineStep('choice_apply_started', { seasonId, episodeId, choiceId });

    try {
      const season = await this.seasonsRepository.findOne({ where: { seasonId } });
      if (!season) {
        throw new Error('Season not found');
      }

      const episode = await this.episodesRepository.findOne({ where: { seasonId, episodeId } });
      if (!episode) {
        throw new Error('Episode not found');
      }

      const selectedChoice = (episode.choices || []).find((choice) => choice.id === choiceId);
      if (!selectedChoice) {
        throw new Error('Choice not found');
      }

      const existingChoiceRecord = await this.episodeChoicesRepository.findOne({ where: { episodeId } });
      if (existingChoiceRecord && existingChoiceRecord.choiceId !== choiceId) {
        const existingNextEpisode = await this.episodesRepository.findOne({
          where: { seasonId, episodeNumber: episode.episodeNumber + 1 },
        });
        throw new Error(
          existingNextEpisode
            ? `Choice ${existingChoiceRecord.choiceId} was already applied for this episode. Open the next episode to continue.`
            : `Choice ${existingChoiceRecord.choiceId} was already selected for this episode and the next episode is still being created. Use Continue / retry that choice instead of switching to ${choiceId}.`,
        );
      }

      if (existingChoiceRecord) {
        const existingNextEpisode = await this.episodesRepository.findOne({
          where: { seasonId, episodeNumber: episode.episodeNumber + 1 },
        });
        if (existingNextEpisode) {
          season.currentEpisodeNumber = existingNextEpisode.episodeNumber;
          season.currentMiniArc = existingNextEpisode.miniArcNumber;
          season.storyState = existingChoiceRecord.resultingStoryState || season.storyState || {};
          season.updatedAt = new Date();
          await this.seasonsRepository.save(season);
          await this.cancelUnusedPreparedBranches(seasonId, episodeId, choiceId);
          this.logPipelineStep('choice_apply_idempotent', {
            seasonId,
            episodeId,
            choiceId,
            nextEpisodeNumber: existingNextEpisode.episodeNumber,
          });
          return this.getSeason(seasonId);
        }

        this.logPipelineStep('choice_apply_resume', {
          seasonId,
          episodeId,
          choiceId,
          nextEpisodeNumber: episode.episodeNumber + 1,
        });
      }

      const seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
      if (!seasonFramework) {
        throw new Error('Season framework not found');
      }

      const hero = await this.heroesRepository.findOne({ where: { seasonId } });
      const updatedStoryState = existingChoiceRecord
        ? existingChoiceRecord.resultingStoryState ||
          this.applyStoryStateUpdate(
            season.storyState || {},
            episode.storyStateDiff || {},
            selectedChoice,
            episode,
          )
        : this.applyStoryStateUpdate(
            season.storyState || {},
            episode.storyStateDiff || {},
            selectedChoice,
            episode,
          );

      // Cancel unused siblings early so they don't steal slots while we generate.
      // If generation fails, we reactivate them in the catch below.
      await this.cancelUnusedPreparedBranches(seasonId, episodeId, selectedChoice.id);

      const nextEpisodeNumber = episode.episodeNumber + 1;
      const outlineItem =
        seasonFramework.episodeOutline?.episodes?.find((item) => item.episodeNumber === nextEpisodeNumber) || null;

      season.storyState = updatedStoryState;
      season.updatedAt = new Date();

      if (!outlineItem) {
        if (!existingChoiceRecord) {
          await this.episodeChoicesRepository.save(
            this.episodeChoicesRepository.create({
              choiceRecordId: uuidv4(),
              seasonId,
              episodeId,
              episodeNumber: episode.episodeNumber,
              choiceId: selectedChoice.id,
              choicePayload: selectedChoice,
              resultingStoryState: updatedStoryState,
              createdAt: new Date(),
            }),
          );
          await this.awardChoiceCrystals(season.ownerUserId, seasonId, episode, selectedChoice);
        }
        season.status = 'season_complete';
        await this.seasonsRepository.save(season);
        this.logPipelineStep('choice_apply_season_complete', { seasonId, episodeId, choiceId });
        return this.getSeason(seasonId);
      }

      const selectedChoiceContext = {
        id: selectedChoice.id,
        text: selectedChoice.text,
        choiceType: selectedChoice.choiceType,
        seasonProgress: selectedChoice.expectedStateDiff?.seasonProgress || '',
      };
      const preparedEpisode = await this.preparedEpisodesRepository.findOne({
        where: { seasonId, sourceEpisodeId: episodeId, choiceId: selectedChoice.id },
      });
      const canUsePreparedEpisode = Boolean(
        preparedEpisode?.payload?.episodeContent &&
          ['ready', 'ready_dry_run', 'ready_text_audio_pending', 'ready_text_audio_partial'].includes(
            preparedEpisode?.status || '',
          ),
      );
      this.logPipelineStep('choice_applied', {
        seasonId,
        episodeId,
        choiceId: selectedChoice.id,
        nextEpisodeNumber,
        resumed: Boolean(existingChoiceRecord),
        canUsePreparedEpisode,
        preparedStatus: preparedEpisode?.status || null,
        preparedIllustrationReady: ['ready', 'ready_dry_run'].includes(
          String(preparedEpisode?.payload?.preparedIllustration?.status || ''),
        ),
      });
      const canUsePreparedPlan = Boolean(
        preparedEpisode?.payload?.episodeDraftPlan &&
          ['plan_ready', 'ready', 'ready_dry_run', 'ready_text_audio_pending', 'ready_text_audio_partial'].includes(
            preparedEpisode?.status || '',
          ) &&
          !canUsePreparedEpisode,
      );
      const nextEpisodeContent = canUsePreparedEpisode
        ? preparedEpisode?.payload?.episodeContent
        : canUsePreparedPlan
          ? await this.generateEpisodeContent(
              season,
              seasonFramework.framework,
              seasonFramework.seasonBible,
              hero,
              outlineItem,
              updatedStoryState,
              this.buildPreviousEpisodeSummary(episode),
              selectedChoiceContext,
              preparedEpisode?.payload?.episodeDraftPlan || null,
              preparedEpisode?.preparedEpisodeId,
            )
        : await this.generateEpisodeContent(
            season,
            seasonFramework.framework,
            seasonFramework.seasonBible,
            hero,
            outlineItem,
            updatedStoryState,
            this.buildPreviousEpisodeSummary(episode),
            selectedChoiceContext,
          );
      await this.syncSeasonCharactersFromEpisode(
        seasonId,
        seasonFramework.seasonBible || {},
        hero,
        nextEpisodeContent,
      );
      const canonicalNextEpisodeContent = await this.canonicalizeEpisodeContentSceneCharacters(
        seasonId,
        nextEpisodeContent,
      );
      const createdEpisode = await this.createEpisodeRecord(
        seasonId,
        nextEpisodeNumber,
        outlineItem,
        canonicalNextEpisodeContent,
        preparedEpisode?.payload?.preparedAudioChunks || [],
        season.childProfile?.languageLevel,
        null,
        preparedEpisode?.preparedEpisodeId,
      );
      await this.resolveEpisodeIllustrationAfterChoice(
        seasonId,
        createdEpisode,
        hero,
        preparedEpisode,
      );

      // Persist the choice only after the next episode exists, so a failed generation
      // cannot lock the user out of switching/retrying.
      if (!existingChoiceRecord) {
        await this.episodeChoicesRepository.save(
          this.episodeChoicesRepository.create({
            choiceRecordId: uuidv4(),
            seasonId,
            episodeId,
            episodeNumber: episode.episodeNumber,
            choiceId: selectedChoice.id,
            choicePayload: selectedChoice,
            resultingStoryState: updatedStoryState,
            createdAt: new Date(),
          }),
        );
        await this.awardChoiceCrystals(season.ownerUserId, seasonId, episode, selectedChoice);
      }

      if (
        preparedEpisode &&
        ['ready', 'ready_dry_run', 'ready_text_audio_pending', 'ready_text_audio_partial', 'queued', 'plan_ready'].includes(
          preparedEpisode.status,
        )
      ) {
        preparedEpisode.status = 'used';
        preparedEpisode.payload = {
          ...(preparedEpisode.payload || {}),
          usedEpisodeId: createdEpisode.episodeId,
          usedAt: new Date().toISOString(),
        };
        preparedEpisode.updatedAt = new Date();
        await this.preparedEpisodesRepository.save(preparedEpisode);
      }

      season.currentEpisodeNumber = createdEpisode.episodeNumber;
      season.currentMiniArc = createdEpisode.miniArcNumber;
      season.status = 'episode_ready';
      season.storyState = {
        ...(season.storyState || {}),
        seasonProgress: {
          ...((season.storyState || {}).seasonProgress || {}),
          currentEpisodeNumber: createdEpisode.episodeNumber,
          currentMiniArc: createdEpisode.miniArcNumber,
        },
      };
      season.updatedAt = new Date();
      await this.seasonsRepository.save(season);
      await this.enqueuePreparedNextEpisodeJobs(
        season,
        seasonFramework.framework,
        seasonFramework.seasonBible,
        hero,
        createdEpisode,
      );

      this.logPipelineStep('choice_apply_completed', {
        seasonId,
        episodeId,
        choiceId,
        createdEpisodeId: createdEpisode.episodeId,
        createdEpisodeNumber: createdEpisode.episodeNumber,
        resumed: Boolean(existingChoiceRecord),
      });

      return this.getSeason(seasonId);
    } catch (error) {
      const formatted = this.formatGenerationError(error);
      this.logPipelineStep('choice_apply_failed', {
        seasonId,
        episodeId,
        choiceId,
        error: formatted,
      });
      this.logger.error(`[EpisodeChoice] apply failed seasonId=${seasonId} episodeId=${episodeId} choiceId=${choiceId} | ${formatted}`);
      try {
        const existingChoice = await this.episodeChoicesRepository.findOne({ where: { episodeId } });
        const sourceEpisode = await this.episodesRepository.findOne({ where: { episodeId } });
        const nextEpisode = sourceEpisode
          ? await this.episodesRepository.findOne({
              where: { seasonId, episodeNumber: sourceEpisode.episodeNumber + 1 },
            })
          : null;
        // Only restore siblings when the choice did not permanently lock in.
        if (!existingChoice || !nextEpisode) {
          await this.reactivateCancelledPreparedBranches(seasonId, episodeId);
        }
      } catch (reactivateError) {
        this.logger.warn(
          `[EpisodeChoice] Failed to reactivate cancelled branches after apply failure: ${this.formatGenerationError(reactivateError)}`,
        );
      }
      throw error;
    }
  }

  async getCurrentEpisode(seasonId: string) {

    const season = await this.getSeason(seasonId);
    return {
      currentEpisode: season.currentEpisode,
      generationJobs: season.generationJobs,
    };
  }

  async getAllSeasonsForProcessing(): Promise<string[]> {
    const seasons = await this.seasonsRepository.find({
      where: { status: 'episode_ready' },
      select: ['seasonId'],
      order: { updatedAt: 'ASC' },
      take: 50,
    });
    const titleJobSeasons = await this.generationJobsRepository
      .createQueryBuilder('job')
      .select('job.seasonId', 'seasonId')
      .where('job.jobType = :jobType', { jobType: 'season_title' })
      .andWhere('job.status = :status', { status: 'pending' })
      .getRawMany<{ seasonId: string }>();
    return Array.from(new Set([...seasons.map((s) => s.seasonId), ...titleJobSeasons.map((job) => job.seasonId)]));
  }

  private getPreparedEpisodeIdFromJob(job: GenerationJob): string {
    return (
      String(job.payload?.preparedEpisodeId || '') ||
      String(job.payload?.metadata?.preparedEpisodeId || '') ||
      ''
    );
  }

  private async cancelUnusedPreparedBranches(
    seasonId: string,
    sourceEpisodeId: string,
    selectedChoiceId: string,
  ) {
    const siblings = await this.preparedEpisodesRepository.find({
      where: { seasonId, sourceEpisodeId },
    });
    const unused = siblings.filter(
      (prepared) =>
        prepared.choiceId !== selectedChoiceId &&
        !['used', 'cancelled'].includes(String(prepared.status || '')),
    );
    if (!unused.length) {
      return { cancelledPrepared: 0, cancelledJobs: 0 };
    }

    const unusedIds = new Set(unused.map((prepared) => prepared.preparedEpisodeId));
    const now = new Date();
    for (const prepared of unused) {
      const previousStatus = prepared.status;
      prepared.status = 'cancelled';
      prepared.payload = {
        ...(prepared.payload || {}),
        previousStatusBeforeCancel: previousStatus,
        cancelledAt: now.toISOString(),
        cancelReason: 'unused_branch_after_choice',
        selectedChoiceId,
      };
      prepared.updatedAt = now;
    }
    await this.preparedEpisodesRepository.save(unused);

    const activeJobs = await this.generationJobsRepository.find({
      where: [
        { seasonId, status: 'pending' },
        { seasonId, status: 'processing' },
      ],
    });
    const jobsToCancel = activeJobs.filter((job) => {
      const preparedId = this.getPreparedEpisodeIdFromJob(job);
      return preparedId && unusedIds.has(preparedId);
    });
    for (const job of jobsToCancel) {
      job.status = 'cancelled';
      job.error = 'cancelled: unused prepared branch after choice';
      job.updatedAt = now;
    }
    if (jobsToCancel.length) {
      await this.generationJobsRepository.save(jobsToCancel);
    }

    this.logPipelineStep('prepared_branches_cancelled', {
      seasonId,
      sourceEpisodeId,
      selectedChoiceId,
      cancelledPreparedIds: Array.from(unusedIds),
      cancelledJobs: jobsToCancel.length,
    });

    return { cancelledPrepared: unused.length, cancelledJobs: jobsToCancel.length };
  }

  private async reactivateCancelledPreparedBranches(seasonId: string, sourceEpisodeId: string) {
    const siblings = await this.preparedEpisodesRepository.find({
      where: { seasonId, sourceEpisodeId },
    });
    const cancelled = siblings.filter(
      (prepared) =>
        prepared.status === 'cancelled' &&
        prepared.payload?.cancelReason === 'unused_branch_after_choice',
    );
    if (!cancelled.length) {
      return { reactivated: 0 };
    }

    const now = new Date();
    for (const prepared of cancelled) {
      const previousStatus = String(prepared.payload?.previousStatusBeforeCancel || 'queued');
      prepared.status = ['queued', 'plan_ready', 'ready', 'ready_text_audio_pending', 'ready_text_audio_partial'].includes(
        previousStatus,
      )
        ? previousStatus
        : 'queued';
      const payload = { ...(prepared.payload || {}) };
      delete payload.cancelledAt;
      delete payload.cancelReason;
      delete payload.selectedChoiceId;
      prepared.payload = payload;
      prepared.updatedAt = now;
    }
    await this.preparedEpisodesRepository.save(cancelled);

    this.logPipelineStep('prepared_branches_reactivated', {
      seasonId,
      sourceEpisodeId,
      reactivatedPreparedIds: cancelled.map((item) => item.preparedEpisodeId),
    });

    return { reactivated: cancelled.length };
  }

  private async abortJobIfPreparedCancelled(
    job: GenerationJob,
    preparedEpisodeId?: string,
  ): Promise<Record<string, any> | null> {
    const preparedId = preparedEpisodeId || this.getPreparedEpisodeIdFromJob(job);
    if (!preparedId) {
      return null;
    }
    const prepared = await this.preparedEpisodesRepository.findOne({
      where: { preparedEpisodeId: preparedId },
    });
    if (prepared?.status !== 'cancelled' && job.status !== 'cancelled') {
      return null;
    }

    job.status = 'cancelled';
    job.error = job.error || 'cancelled: prepared branch unused';
    job.updatedAt = new Date();
    await this.generationJobsRepository.save(job);
    return {
      jobId: job.jobId,
      status: 'cancelled',
      reason: 'prepared_cancelled',
    };
  }

  private isCriticalLiveJob(job: GenerationJob, currentEpisodeId: string | null): boolean {
    if (!currentEpisodeId) {
      return false;
    }
    if (job.jobType === 'tts_chunk' || job.jobType === 'image_generation') {
      return String(job.episodeId || '') === currentEpisodeId;
    }
    return false;
  }

  private isPrefetchJob(job: GenerationJob): boolean {
    return String(job.jobType || '').startsWith('prepared_');
  }

  private recordPixazoFailure() {
    const now = Date.now();
    this.pixazoFailureTimestamps.push(now);
    while (
      this.pixazoFailureTimestamps.length &&
      now - this.pixazoFailureTimestamps[0] > PIXAZO_CIRCUIT_WINDOW_MS
    ) {
      this.pixazoFailureTimestamps.shift();
    }
  }

  private shouldSkipPrefetchImages(): boolean {
    const now = Date.now();
    while (
      this.pixazoFailureTimestamps.length &&
      now - this.pixazoFailureTimestamps[0] > PIXAZO_CIRCUIT_WINDOW_MS
    ) {
      this.pixazoFailureTimestamps.shift();
    }
    return this.pixazoFailureTimestamps.length >= PIXAZO_CIRCUIT_FAILURE_THRESHOLD;
  }

  private countWords(text: string): number {
    return String(text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }

  private exceedsChapterTtsBudget(text: string): boolean {
    return this.countWords(text) > CHAPTER_TTS_MAX_WORDS || text.length > CHAPTER_TTS_MAX_CHARS;
  }

  /** Pack text into TTS parts on sentence/word boundaries only — never mid-word. */
  private splitChapterTextForTts(text: string): string[] {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return [];
    }
    if (!this.exceedsChapterTtsBudget(trimmed)) {
      return [trimmed];
    }

    const paragraphs = trimmed
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const units =
      paragraphs.length > 1
        ? paragraphs.flatMap((paragraph) => this.splitTextIntoSentences(paragraph))
        : this.splitTextIntoSentences(trimmed);

    const parts: string[] = [];
    let current = '';

    const flush = () => {
      if (current) {
        parts.push(current);
        current = '';
      }
    };

    for (const unit of units) {
      if (this.exceedsChapterTtsBudget(unit)) {
        flush();
        for (const wordPart of this.splitTextByWords(unit, CHAPTER_TTS_MAX_WORDS, CHAPTER_TTS_MAX_CHARS)) {
          if (parts.length >= CHAPTER_TTS_MAX_PARTS - 1) {
            current = current ? `${current} ${wordPart}` : wordPart;
          } else {
            parts.push(wordPart);
          }
        }
        continue;
      }

      const candidate = current ? `${current} ${unit}` : unit;
      if (
        current &&
        this.exceedsChapterTtsBudget(candidate) &&
        parts.length < CHAPTER_TTS_MAX_PARTS - 1
      ) {
        parts.push(current);
        current = unit;
      } else {
        current = candidate;
      }
    }
    flush();

    if (parts.length <= CHAPTER_TTS_MAX_PARTS) {
      return parts;
    }

    const merged: string[] = [];
    const bucketSize = Math.ceil(parts.length / CHAPTER_TTS_MAX_PARTS);
    for (let i = 0; i < parts.length; i += bucketSize) {
      merged.push(parts.slice(i, i + bucketSize).join(' '));
    }
    return merged.slice(0, CHAPTER_TTS_MAX_PARTS);
  }

  private splitTextIntoSentences(text: string): string[] {
    const parts = String(text || '')
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length ? parts : [String(text || '').trim()].filter(Boolean);
  }

  private splitTextByWords(text: string, maxWords: number, maxChars: number): string[] {
    const words = String(text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) {
      return [];
    }

    const parts: string[] = [];
    let currentWords: string[] = [];

    const flush = () => {
      if (currentWords.length) {
        parts.push(currentWords.join(' '));
        currentWords = [];
      }
    };

    for (const word of words) {
      const nextWords = [...currentWords, word];
      const nextText = nextWords.join(' ');
      if (
        currentWords.length &&
        (nextWords.length > maxWords || nextText.length > maxChars)
      ) {
        flush();
        currentWords = [word];
      } else {
        currentWords = nextWords;
      }
    }
    flush();
    return parts;
  }

  private expandChapterAudioChunks(
    episodeId: string,
    chunks: Record<string, any>[],
  ): Record<string, any>[] {
    const expanded: Record<string, any>[] = [];
    for (const chunk of chunks) {
      if (chunk?.type !== 'chapter' || !chunk?.text) {
        expanded.push(chunk);
        continue;
      }
      // Keep prebuilt multi-part or already-ready chapter chunks intact.
      if (chunk.partIndex != null || chunk.audioUrl || chunk.status === 'ready' || chunk.status === 'ready_dry_run') {
        expanded.push(chunk);
        continue;
      }
      const parts = this.splitChapterTextForTts(String(chunk.text));
      if (parts.length <= 1) {
        expanded.push({
          ...chunk,
          type: 'chapter',
          partIndex: 0,
        });
        continue;
      }
      parts.forEach((partText, index) => {
        expanded.push({
          chunkId: index === 0 ? chunk.chunkId || uuidv4() : uuidv4(),
          episodeId,
          type: 'chapter',
          choiceId: null,
          partIndex: index,
          text: partText,
          status: chunk.status || 'pending',
          audioUrl: null,
        });
      });
    }
    return expanded;
  }

  async processPendingGenerationJobs(
    seasonId: string,
    options: {
      limit?: number;
      dryRun?: boolean;
      jobType?: string;
    } = {},
  ) {

    const limit = Math.min(Math.max(Number(options.limit || 5), 1), 20);
    const criticalLimit = Math.max(1, Math.ceil(limit * 0.7));
    const prefetchLimit = Math.max(0, limit - criticalLimit);
    const results = [];
    const dryRun = Boolean(options.dryRun);
    const contentJobTypes = new Set([
      'prepared_branch_plan',
      'prepared_episode_prose',
      'prepared_episode',
      'season_title',
    ]);
    const ttsJobTypes = new Set(['prepared_tts_chunk', 'tts_chunk']);
    const imageJobTypes = new Set(['prepared_image_generation', 'image_generation']);

    await this.expireOverdueGenerationJobs(seasonId, options.jobType);
    await this.reconcilePreparedAudioChunksForSeason(seasonId);
    await this.reconcileEpisodeAudioChunksForSeason(seasonId);
    await this.enqueueMissingPreparedTtsJobs(seasonId);

    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    const currentEpisode = season
      ? await this.episodesRepository.findOne({
          where: { seasonId, episodeNumber: season.currentEpisodeNumber },
        })
      : null;
    const currentEpisodeId = currentEpisode?.episodeId || null;

    const recoverStaleProcessingJobs = async () => {
      const staleBefore = new Date(Date.now() - STALE_PROCESSING_JOB_TIMEOUT_MS);
      const staleWhere = options.jobType
        ? { seasonId, status: 'processing' as const, jobType: options.jobType }
        : { seasonId, status: 'processing' as const };
      const staleJobs = await this.generationJobsRepository.find({
        where: staleWhere,
        order: { updatedAt: 'ASC' },
      });

      for (const staleJob of staleJobs) {
        if (staleJob.updatedAt && staleJob.updatedAt.getTime() > staleBefore.getTime()) {
          continue;
        }

        await this.requeueProcessingJob(staleJob, `season worker stale recovery seasonId=${seasonId}`);
      }
    };

    const typePriority: Record<string, number> = {
      // Live current-episode media first (critical path for reading UX)
      tts_chunk: 0,
      image_generation: 1,
      // Prefetch content then media
      prepared_branch_plan: 2,
      prepared_episode_prose: 3,
      prepared_episode: 4,
      prepared_tts_chunk: 5,
      prepared_image_generation: 6,
      season_title: 7,
    };

    const pullPendingJobs = async () => {
      await recoverStaleProcessingJobs();
      const pendingJobs = await this.generationJobsRepository.find({
        where: options.jobType
          ? { seasonId, status: 'pending', jobType: options.jobType }
          : { seasonId, status: 'pending' },
        order: { createdAt: 'ASC' },
        take: limit * 6,
      });
      return pendingJobs.sort((left, right) => {
        const leftCritical = this.isCriticalLiveJob(left, currentEpisodeId) ? 0 : 1;
        const rightCritical = this.isCriticalLiveJob(right, currentEpisodeId) ? 0 : 1;
        if (leftCritical !== rightCritical) {
          return leftCritical - rightCritical;
        }
        const priorityDiff = (typePriority[left.jobType] ?? 9) - (typePriority[right.jobType] ?? 9);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return left.createdAt.getTime() - right.createdAt.getTime();
      });
    };

    const recordResult = (job: GenerationJob, result?: Record<string, any>) => {
      if (!result) {
        return;
      }
      if (result.status === 'failed' || result.error) {
        this.logGenerationJobFailed(job, String(result.error || job.error || 'unknown'));
      }
      results.push(result);
    };

    const executeJob = async (job: GenerationJob) => {
      if (job.jobType === 'tts_chunk') {
        return this.processTtsJob(job, dryRun);
      }
      if (job.jobType === 'image_generation') {
        return this.processIllustrationJob(job, dryRun);
      }
      if (job.jobType === 'prepared_image_generation') {
        return this.processPreparedImageJob(job, dryRun);
      }
      if (job.jobType === 'prepared_branch_plan') {
        return this.processPreparedBranchPlanJob(job, dryRun);
      }
      if (job.jobType === 'prepared_episode_prose') {
        return this.processPreparedEpisodeProseJob(job, dryRun);
      }
      if (job.jobType === 'prepared_episode') {
        return this.processPreparedEpisodeJob(job, dryRun);
      }
      if (job.jobType === 'prepared_tts_chunk') {
        return this.processPreparedTtsJob(job, dryRun);
      }
      if (job.jobType === 'season_title') {
        return this.processSeasonTitleJob(job, dryRun);
      }
      return undefined;
    };

    const skipPrefetchImages = this.shouldSkipPrefetchImages();
    const hasCriticalPendingTts = (jobs: GenerationJob[]) =>
      jobs.some((job) => job.jobType === 'tts_chunk' && this.isCriticalLiveJob(job, currentEpisodeId));

    const selectMediaJobs = (
      pendingJobs: GenerationJob[],
      mediaSlots: number,
      preferCriticalOnly: boolean,
    ) => {
      const imageSlots = Math.min(2, mediaSlots);
      const ttsSlots = Math.min(3, Math.max(mediaSlots - imageSlots, 0));
      const selectedMediaJobs: GenerationJob[] = [];
      const seenJobIds = new Set<string>();

      const eligible = pendingJobs.filter((job) => {
        if (preferCriticalOnly && !this.isCriticalLiveJob(job, currentEpisodeId)) {
          return false;
        }
        if (
          skipPrefetchImages &&
          job.jobType === 'prepared_image_generation'
        ) {
          return false;
        }
        return true;
      });

      // Critical TTS first, then critical images, then remaining TTS/images.
      const ordered = [
        ...eligible.filter((job) => job.jobType === 'tts_chunk' && this.isCriticalLiveJob(job, currentEpisodeId)),
        ...eligible.filter((job) => job.jobType === 'image_generation' && this.isCriticalLiveJob(job, currentEpisodeId)),
        ...eligible.filter((job) => ttsJobTypes.has(job.jobType) && !this.isCriticalLiveJob(job, currentEpisodeId)),
        ...eligible.filter((job) => imageJobTypes.has(job.jobType) && !this.isCriticalLiveJob(job, currentEpisodeId)),
      ];

      for (const job of ordered) {
        if (selectedMediaJobs.length >= mediaSlots) {
          break;
        }
        if (seenJobIds.has(job.jobId)) {
          continue;
        }
        if (ttsJobTypes.has(job.jobType)) {
          if (selectedMediaJobs.filter((item) => ttsJobTypes.has(item.jobType)).length >= ttsSlots) {
            continue;
          }
        } else if (imageJobTypes.has(job.jobType)) {
          if (selectedMediaJobs.filter((item) => imageJobTypes.has(item.jobType)).length >= imageSlots) {
            continue;
          }
        } else {
          continue;
        }
        selectedMediaJobs.push(job);
        seenJobIds.add(job.jobId);
      }

      return selectedMediaJobs;
    };

    // --- Critical lane: live current-episode jobs first ---
    const initialPendingJobs = await pullPendingJobs();

    const criticalMediaBudget = Math.min(criticalLimit, Math.max(limit - results.length, 0));
    if (criticalMediaBudget > 0) {
      const criticalMediaJobs = selectMediaJobs(initialPendingJobs, criticalMediaBudget, true);
      const mediaResults = await Promise.all(
        criticalMediaJobs.map(async (job) => ({
          job,
          result: await executeJob(job),
        })),
      );
      for (const item of mediaResults) {
        recordResult(item.job, item.result);
      }
    }

    // --- Prefetch lane: only after critical TTS is clear (or no critical TTS pending) ---
    const refreshedPendingJobs = await pullPendingJobs();
    const blockPrefetchMedia = hasCriticalPendingTts(refreshedPendingJobs);

    const firstContentJob = refreshedPendingJobs.find((job) => contentJobTypes.has(job.jobType));
    if (firstContentJob && results.length < limit) {
      const result = await executeJob(firstContentJob);
      recordResult(firstContentJob, result);
    }

    const prefetchMediaSlots = Math.min(
      prefetchLimit,
      Math.max(limit - results.length, 0),
    );
    if (prefetchMediaSlots > 0 && !blockPrefetchMedia) {
      const afterContentPending = await pullPendingJobs();
      const prefetchMediaJobs = selectMediaJobs(afterContentPending, prefetchMediaSlots, false).filter(
        (job) => this.isPrefetchJob(job) || !this.isCriticalLiveJob(job, currentEpisodeId),
      );
      // Prefer remaining critical if any slipped through, else prefetch
      const mediaResults = await Promise.all(
        prefetchMediaJobs.map(async (job) => ({
          job,
          result: await executeJob(job),
        })),
      );
      for (const item of mediaResults) {
        recordResult(item.job, item.result);
      }
    } else if (prefetchMediaSlots > 0 && blockPrefetchMedia) {
      // Still drain remaining critical media if budget left
      const leftoverCritical = selectMediaJobs(refreshedPendingJobs, prefetchMediaSlots, true);
      const mediaResults = await Promise.all(
        leftoverCritical.map(async (job) => ({
          job,
          result: await executeJob(job),
        })),
      );
      for (const item of mediaResults) {
        recordResult(item.job, item.result);
      }
    }

    return {
      processed: results.length,
      results,
      season: await this.getSeason(seasonId),
    };
  }

  async getUserProgress(ownerUserId: string) {
    const seasons = await this.seasonsRepository.find({
      where: { ownerUserId },
      order: { updatedAt: 'DESC' },
    });

    if (seasons.length === 0) {
      return {
        ownerUserId,
        totals: {
          seasons: 0,
          episodesCompleted: 0,
          activeVocabulary: 0,
          openedIllustrations: 0,
          crystalsEarned: 0,
          crystalsSpent: 0,
          currentCrystalBalance: 0,
          voiceAttemptsObserved: 0,
        },
        seasons: [],
        exposuresByWord: [],
        choicePattern: [],
      };
    }

    const seasonIds = seasons.map((season) => season.seasonId);
    const choices = await this.episodeChoicesRepository.find({
      where: seasonIds.map((seasonId) => ({ seasonId })),
      order: { createdAt: 'ASC' },
    });
    const episodes = await this.episodesRepository.find({
      where: seasonIds.map((seasonId) => ({ seasonId })),
      order: { episodeNumber: 'ASC' },
    });
    const wallets = await this.crystalWalletsRepository.find({
      where: { ownerUserId },
      order: { createdAt: 'ASC' },
    });
    const ledgerEntries = await this.crystalLedgerRepository.find({
      where: seasonIds.map((seasonId) => ({ seasonId })),
      order: { createdAt: 'ASC' },
    });
    const heroes = await this.heroesRepository.find({
      where: seasonIds.map((seasonId) => ({ seasonId })),
    });

    const exposures = new Map<string, number>();
    const choicePattern = new Map<string, number>();

    for (const season of seasons) {
      const seasonExposures = Array.isArray(season.storyState?.vocabularyExposures) ? season.storyState.vocabularyExposures : [];
      for (const item of seasonExposures) {
        const term = String(item?.term || '').trim();
        if (!term) {
          continue;
        }
        exposures.set(term, (exposures.get(term) || 0) + Number(item?.exposureCountDelta || 1));
      }
    }

    for (const choice of choices) {
      const choiceType = String(choice.choicePayload?.choiceType || 'unknown');
      choicePattern.set(choiceType, (choicePattern.get(choiceType) || 0) + 1);
    }

    const crystalsEarned = ledgerEntries
      .filter((entry) => entry.direction === 'credit')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const crystalsSpent = ledgerEntries
      .filter((entry) => entry.direction === 'debit')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const currentCrystalBalance = wallets[0]?.balance || 0;
    const voiceAttemptsObserved = ledgerEntries.filter((entry) => entry.reason === 'voice_attempt').length;

    return {
      ownerUserId,
      totals: {
        seasons: seasons.length,
        episodesCompleted: choices.length,
        activeVocabulary: exposures.size,
        openedIllustrations: heroes.filter((hero) => Boolean(hero.heroReferenceImageUrl)).length,
        crystalsEarned,
        crystalsSpent,
        currentCrystalBalance,
        voiceAttemptsObserved,
      },
      exposuresByWord: Array.from(exposures.entries())
        .map(([term, exposureCount]) => ({ term, exposureCount }))
        .sort((left, right) => right.exposureCount - left.exposureCount),
      choicePattern: Array.from(choicePattern.entries())
        .map(([choiceType, count]) => ({ choiceType, count }))
        .sort((left, right) => right.count - left.count),
      seasons: seasons.map((season) => {
        const currentWallet = wallets[0];
        const completedEpisodes = choices.filter((choice) => choice.seasonId === season.seasonId).length;
        const generatedEpisodes = episodes.filter((episode) => episode.seasonId === season.seasonId).length;
        const activeVocabulary = Array.from(
          new Set(
            (Array.isArray(season.storyState?.vocabularyExposures) ? season.storyState.vocabularyExposures : [])
              .map((item) => String(item?.term || '').trim())
              .filter(Boolean),
          ),
        );

        return {
          seasonId: season.seasonId,
          childName: season.childProfile?.childName || '',
          theme: season.seasonSetup?.theme || '',
          world: season.seasonSetup?.world || '',
          status: season.status,
          currentEpisodeNumber: season.currentEpisodeNumber,
          completedEpisodes,
          generatedEpisodes,
          currentMiniArc: season.currentMiniArc,
          centralProblemStatus: season.storyState?.seasonProgress?.centralProblemStatus || '',
          dramaticQuestionProgress: season.storyState?.seasonProgress?.dramaticQuestionProgress || '',
          activeVocabulary,
          heroReady: heroes.some((hero) => hero.seasonId === season.seasonId && Boolean(hero.heroReferenceImageUrl)),
          crystalBalance: currentWallet?.balance || 0,
        };
      }),
    };
  }

  async getStorybook(seasonId: string) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const framework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
    const crystalWallet = await this.getOrCreateCrystalWallet(season.ownerUserId, seasonId);
    const storybookEntries = await this.storybookEntriesRepository.find({
      where: { seasonId },
      order: { createdAt: 'ASC' },
    });
    const illustrations = await this.illustrationsRepository.find({
      where: { seasonId },
      order: { createdAt: 'ASC' },
    });
    const episodes = await this.episodesRepository.find({
      where: { seasonId },
      order: { episodeNumber: 'ASC' },
      select: ['episodeId', 'episodeNumber', 'title', 'illustrationCandidate'],
    });
    const generationJobs = await this.generationJobsRepository.find({
      where: { seasonId, jobType: 'image_generation' },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    return {
      seasonId: season.seasonId,
      status: season.status,
      storyState: season.storyState || {},
      seasonSetup: {
        ...(season.seasonSetup || {}),
        seasonCoverImageUrl: this.mapStorageUrl(season.seasonSetup?.seasonCoverImageUrl),
      },
      framework: framework
        ? {
            seasonPremise: framework.framework?.seasonPremise || null,
            title: framework.framework?.title || null,
          }
        : null,
      crystalWallet: {
        walletId: crystalWallet.walletId,
        balance: crystalWallet.balance,
      },
      episodes: episodes.map((episode) => ({
        episodeId: episode.episodeId,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        illustrationCandidate: episode.illustrationCandidate || null,
      })),
      generationJobs: generationJobs.map((job) => ({
        jobId: job.jobId,
        jobType: job.jobType,
        status: job.status,
        payload: {
          illustrationId: job.payload?.illustrationId || null,
          storybookEntryId: job.payload?.storybookEntryId || null,
          episodeId: job.payload?.episodeId || null,
        },
      })),
      storybook: {
        entries: storybookEntries.map((entry) => this.mapStorybookEntryForResponse(entry, illustrations)),
        illustrations: illustrations.map((illustration) => {
          const entry = storybookEntries.find((item) => item.illustrationId === illustration.illustrationId);
          return this.mapIllustrationForResponse(illustration, entry || null);
        }),
      },
    };
  }

  async setStorybookEntryFavorite(seasonId: string, entryId: string, favorited: boolean) {
    const entry = await this.storybookEntriesRepository.findOne({
      where: { seasonId, storybookEntryId: entryId },
    });
    if (!entry) {
      throw new Error('Storybook entry not found');
    }

    const now = new Date();
    entry.metadata = {
      ...(entry.metadata || {}),
      favorited: Boolean(favorited),
      favoritedAt: favorited ? now.toISOString() : null,
    };
    entry.updatedAt = now;
    await this.storybookEntriesRepository.save(entry);
    return this.getSeason(seasonId);
  }

  private mapStorybookEntryForResponse(
    entry: StorybookEntry,
    illustrations: Array<{ illustrationId: string; imageUrl?: string | null; status?: string; promptPayload?: Record<string, any> }>,
  ) {
    const illustration = entry.illustrationId
      ? illustrations.find((item) => item.illustrationId === entry.illustrationId)
      : null;
    const episodeNumber =
      Number(entry.metadata?.episodeNumber) ||
      Number(illustration?.promptPayload?.episodeNumber) ||
      null;
    const episodeTitle =
      String(entry.metadata?.episodeTitle || illustration?.promptPayload?.episodeTitle || '') || null;
    const favorited = Boolean(entry.metadata?.favorited);
    const favoritedAt = entry.metadata?.favoritedAt ? String(entry.metadata.favoritedAt) : null;
    const mappedImageUrl =
      entry.status === 'locked' || !illustration?.imageUrl
        ? null
        : this.mapStorageUrl(illustration.imageUrl);

    return {
      storybookEntryId: entry.storybookEntryId,
      seasonId: entry.seasonId,
      episodeId: entry.episodeId,
      illustrationId: entry.illustrationId,
      entryType: entry.entryType,
      title: entry.title,
      summary: entry.summary,
      status: entry.status,
      unlockCost: entry.unlockCost,
      episodeNumber,
      episodeTitle,
      favorited,
      favoritedAt,
      imageUrl: mappedImageUrl,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  async getPreparedNext(seasonId: string) {

    const season = await this.getSeason(seasonId);
    return {
      seasonId,
      currentEpisodeId: season.currentEpisode?.episodeId || null,
      currentEpisodeNumber: season.currentEpisode?.episodeNumber || null,
      preparedNext: season.preparedNext || [],
    };
  }

  async unlockIllustration(seasonId: string, episodeId: string) {

    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const episode = await this.episodesRepository.findOne({ where: { seasonId, episodeId } });
    if (!episode) {
      throw new Error('Episode not found');
    }

    const hero = await this.heroesRepository.findOne({ where: { seasonId } });
    if (!hero?.heroReferenceImageUrl) {
      throw new Error('Hero reference image is not ready yet');
    }

    const candidate = episode.illustrationCandidate || {};
    if (!candidate.shouldGenerate || !candidate.moment) {
      throw new Error('This episode does not have an unlockable illustration');
    }

    const preparedEpisode = await this.findPreparedEpisodeForCurrentEpisode(seasonId, episode);
    const preparedIllustration = preparedEpisode?.payload?.preparedIllustration || null;
    const preparedIllustrationReady = ['ready', 'ready_dry_run'].includes(String(preparedIllustration?.status || ''));
    const preparedIllustrationInProgress = preparedEpisode
      ? await this.isPreparedIllustrationInProgress(seasonId, preparedEpisode)
      : false;

    const existingEntry = await this.storybookEntriesRepository.findOne({
      where: { seasonId, episodeId, entryType: 'episode_illustration' },
    });
    if (existingEntry) {
      if (existingEntry.status === 'ready' || existingEntry.status === 'ready_dry_run') {
        return this.getSeason(seasonId);
      }

      const existingIllustration = existingEntry.illustrationId
        ? await this.illustrationsRepository.findOne({ where: { illustrationId: existingEntry.illustrationId } })
        : null;

      if (existingIllustration?.imageUrl) {
        existingEntry.status = 'ready';
        existingEntry.updatedAt = new Date();
        await this.storybookEntriesRepository.save(existingEntry);
        return this.getSeason(seasonId);
      }

      await this.debitIllustrationUnlockIfNeeded(
        season.ownerUserId,
        seasonId,
        episode.episodeId,
        episode.episodeNumber,
        String(existingIllustration?.illustrationId || existingEntry.illustrationId || ''),
      );

      const now = new Date();

      if (preparedEpisode && preparedIllustrationReady) {
        existingEntry.status = 'queued';
        existingEntry.updatedAt = now;
        await this.storybookEntriesRepository.save(existingEntry);
        await this.attachPreparedIllustration(seasonId, episode, hero, preparedEpisode);
        return this.getSeason(seasonId);
      }

      existingEntry.status = 'queued';
      existingEntry.updatedAt = now;
      await this.storybookEntriesRepository.save(existingEntry);
      if (preparedIllustrationInProgress) {
        return this.getSeason(seasonId);
      }

      const hasActiveIllustrationJob = await this.isIllustrationJobInProgress(seasonId, episodeId);
      if (!hasActiveIllustrationJob) {
        await this.enqueueIllustrationJob(
          seasonId,
          episode,
          existingIllustration?.illustrationId || existingEntry.illustrationId,
          existingEntry.storybookEntryId,
        );
      }
      return this.getSeason(seasonId);
    }

    const unlockCost = ILLUSTRATION_UNLOCK_COST;
    const now = new Date();
    const illustrationId = String(preparedIllustration?.illustrationId || uuidv4());
    const storybookEntryId = uuidv4();

    await this.debitIllustrationUnlockIfNeeded(
      season.ownerUserId,
      seasonId,
      episode.episodeId,
      episode.episodeNumber,
      illustrationId,
    );

    const initialIllustrationStatus = preparedIllustrationReady ? 'ready' : 'queued';
    const initialEntryStatus = preparedIllustrationReady ? 'ready' : 'queued';
    const initialPromptPayload = preparedIllustration?.promptPayload || {
      moment: candidate.moment,
      episodeNumber: episode.episodeNumber,
      episodeTitle: episode.title,
      chapterText: episode.chapterText,
      sceneCharacters: candidate.sceneCharacters || [],
    };

    await this.illustrationsRepository.save(
      this.illustrationsRepository.create({
        illustrationId,
        seasonId,
        episodeId,
        entryType: 'episode_illustration',
        title: episode.title,
        status: initialIllustrationStatus,
        imageUrl: preparedIllustrationReady ? preparedIllustration?.imageUrl || null : null,
        promptPayload: initialPromptPayload,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.storybookEntriesRepository.save(
      this.storybookEntriesRepository.create({
        storybookEntryId,
        seasonId,
        episodeId,
        illustrationId,
        entryType: 'episode_illustration',
        title: `Episode ${episode.episodeNumber}: ${episode.title}`,
        summary: candidate.moment,
        status: initialEntryStatus,
        unlockCost,
        metadata: {
          episodeNumber: episode.episodeNumber,
          currentChoiceCount: Array.isArray(episode.choices) ? episode.choices.length : 0,
          pregenerated: Boolean(preparedEpisode),
          preparedEpisodeId: preparedEpisode?.preparedEpisodeId || null,
        },
        createdAt: now,
        updatedAt: now,
      }),
    );

    if (preparedEpisode) {
      if (preparedIllustrationReady) {
        await this.attachPreparedIllustration(seasonId, episode, hero, preparedEpisode);
      }
      return this.getSeason(seasonId);
    }

    await this.enqueueIllustrationJob(seasonId, episode, illustrationId, storybookEntryId);

    return this.getSeason(seasonId);
  }

  async recordVoiceAttempt(
    seasonId: string,
    payload: {
      episodeId?: string;
      targetPhrase?: string;
      transcript?: string;
    },
  ) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const episodeId = String(payload?.episodeId || '');
    const episode = episodeId
      ? await this.episodesRepository.findOne({ where: { seasonId, episodeId } })
      : null;
    const targetPhrase = String(payload?.targetPhrase || episode?.speakingPrompt || '').trim();
    const transcript = String(payload?.transcript || '').trim();

    if (!episode || !targetPhrase || !transcript) {
      return {
        season: await this.getSeason(seasonId),
        voiceAttempt: {
          status: 'missing_input',
          rewarded: false,
          crystalsAwarded: 0,
          transcript,
          targetPhrase,
        },
      };
    }

    if (!this.speechMatchesTarget(targetPhrase, transcript)) {
      await this.recordLearningEvent(seasonId, {
        episodeId,
        eventType: 'voice_attempt',
        payload: { targetPhrase, matched: false },
      });
      return {
        season: await this.getSeason(seasonId),
        voiceAttempt: {
          status: 'not_matched',
          rewarded: false,
          crystalsAwarded: 0,
          transcript,
          targetPhrase,
        },
      };
    }

    const existingVoiceAttempts = await this.crystalLedgerRepository.find({
      where: {
        ownerUserId: season.ownerUserId,
        seasonId,
        reason: 'voice_attempt',
      },
    });
    const alreadyRewardedForPhrase = existingVoiceAttempts.some(
      (entry) => this.normalizeSpeakingPhraseKey(String(entry.metadata?.targetPhrase || '')) === this.normalizeSpeakingPhraseKey(targetPhrase),
    );
    if (alreadyRewardedForPhrase) {
      return {
        season: await this.getSeason(seasonId),
        voiceAttempt: {
          status: 'already_awarded',
          rewarded: false,
          crystalsAwarded: 0,
          transcript,
          targetPhrase,
        },
      };
    }

    await this.creditCrystals(season.ownerUserId, seasonId, 1, 'voice_attempt', {
      episodeId,
      targetPhrase,
      transcript: transcript.slice(0, 200),
    });

    await this.recordLearningEvent(seasonId, {
      episodeId,
      eventType: 'voice_success',
      payload: { targetPhrase, matched: true },
    });

    return {
      season: await this.getSeason(seasonId),
      voiceAttempt: {
        status: 'awarded',
        rewarded: true,
        crystalsAwarded: 1,
        transcript,
        targetPhrase,
      },
    };
  }

  async generateHero(
    seasonId: string,
    preferences: {
      preferredName: string;
      heroType: string;
      traits: string[];
      companion: string;
      favoriteColor: string;
      accessory: string;
      description?: string;
      ageYears?: number;
      gender?: string;
    },
  ) {

    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      throw new Error('Season not found');
    }

    const seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
    if (!seasonFramework) {
      throw new Error('Season framework not found');
    }

    const normalizedPreferences = {
      preferredName: preferences.preferredName?.trim() || season.childProfile?.childName || 'Nova',
      heroType: preferences.heroType?.trim() || 'young explorer',
      traits: (preferences.traits || []).map((item) => item.trim()).filter(Boolean).slice(0, 3),
      companion: preferences.companion?.trim() || 'tiny lantern bird',
      favoriteColor: preferences.favoriteColor?.trim() || 'gold',
      accessory: preferences.accessory?.trim() || 'satchel',
      description: preferences.description?.trim() || '',
      ageYears: Number(preferences.ageYears) || Number(season.childProfile?.childAge) || undefined,
      gender: preferences.gender?.trim() || '',
    };

    const protagonist = this.buildSeasonProtagonistContext(season);
    const generatedHero = await this.generateHeroProfileAndVisualBrief(
      normalizedPreferences,
      protagonist,
      season.seasonSetup,
      seasonFramework.framework,
      seasonFramework.seasonBible,
    );
    generatedHero.heroProfile = {
      ...(generatedHero.heroProfile || {}),
      ageYears: normalizedPreferences.ageYears || Number(generatedHero?.heroProfile?.ageYears) || 9,
    };
    const now = new Date();
    const existingHero = await this.heroesRepository.findOne({ where: { seasonId } });

    if (existingHero) {
      existingHero.heroProfile = generatedHero.heroProfile;
      existingHero.heroVisualBrief = generatedHero.heroVisualBrief;
      existingHero.heroReferenceImageUrl = existingHero.heroReferenceImageUrl || null;
      existingHero.heroPreferences = normalizedPreferences;
      existingHero.generationStatus = 'ready';
      existingHero.promptVersion = HERO_PROMPT_VERSION;
      existingHero.updatedAt = now;
      await this.heroesRepository.save(existingHero);
    } else {
      await this.heroesRepository.save(
        this.heroesRepository.create({
          seasonId,
          heroProfile: generatedHero.heroProfile,
          heroVisualBrief: generatedHero.heroVisualBrief,
          heroReferenceImageUrl: null,
          generationStatus: 'ready',
          heroPreferences: normalizedPreferences,
          promptVersion: HERO_PROMPT_VERSION,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    season.status = 'hero_ready';
    season.updatedAt = now;
    await this.seasonsRepository.save(season);

    const savedHero = await this.heroesRepository.findOne({ where: { seasonId } });
    if (savedHero) {
      await this.seasonCharactersService.ensureSeasonRoster(
        seasonId,
        savedHero,
        seasonFramework.seasonBible || {},
      );
    }

    void this.generateHeroReferenceImageInBackground(
      seasonId,
      generatedHero.heroProfile,
      generatedHero.heroVisualBrief,
    );

    return this.getSeason(seasonId);
  }

  private async generateHeroReferenceImageInBackground(
    seasonId: string,
    heroProfile: Record<string, any>,
    heroVisualBrief: Record<string, any>,
  ) {
    const existing = this.heroReferenceImageInFlight.get(seasonId);
    if (existing) {
      return existing;
    }

    const task = (async () => {
      try {
        const hero = await this.heroesRepository.findOne({ where: { seasonId } });
        if (!hero || hero.heroReferenceImageUrl) {
          return;
        }
        const heroReferenceImageUrl = await this.generateHeroReferenceImage(heroProfile, heroVisualBrief);
        hero.heroReferenceImageUrl = heroReferenceImageUrl || null;
        hero.updatedAt = new Date();
        await this.heroesRepository.save(hero);
        void this.generateSeasonCoverInBackground(seasonId);
      } catch (error) {
        this.logger.warn(
          `[HeroReferenceImage] Failed to backfill hero reference image for seasonId=${seasonId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })().finally(() => this.heroReferenceImageInFlight.delete(seasonId));

    this.heroReferenceImageInFlight.set(seasonId, task);
    return task;
  }

  private async ensureSeasonVisualAssetsInBackground(seasonId: string) {
    if (this.visualBackfillInFlight.has(seasonId)) {
      return;
    }

    const task = this.backfillSeasonVisuals(seasonId)
      .then(() => undefined)
      .catch((error) => {
        this.logger.warn(
          `[SeasonVisuals] Failed to ensure visual assets for seasonId=${seasonId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => this.visualBackfillInFlight.delete(seasonId));

    this.visualBackfillInFlight.set(seasonId, task);
  }

  async backfillSeasonVisuals(seasonId: string, options: { forceCover?: boolean } = {}) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    const hero = await this.heroesRepository.findOne({ where: { seasonId } });
    const framework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
    if (!season || !hero || !framework) {
      throw new Error('Season hero or framework not found');
    }

    let heroGenerated = false;
    let coverGenerated = false;

    if (!hero.heroReferenceImageUrl) {
      await this.generateHeroReferenceImageInBackground(
        seasonId,
        hero.heroProfile || {},
        hero.heroVisualBrief || {},
      );
      heroGenerated = true;
    }

    const refreshedHero = await this.heroesRepository.findOne({ where: { seasonId } });
    const refreshedSeason = await this.seasonsRepository.findOne({ where: { seasonId } });
    const coverStatus = String(refreshedSeason?.seasonSetup?.seasonCoverGenerationStatus || '');
    const stuckProcessing =
      coverStatus === 'processing' && !refreshedSeason?.seasonSetup?.seasonCoverImageUrl;
    const needsCover =
      Boolean(refreshedHero?.heroReferenceImageUrl) &&
      (!refreshedSeason?.seasonSetup?.seasonCoverImageUrl ||
        (options.forceCover && coverStatus === 'failed') ||
        stuckProcessing);

    if (needsCover) {
      if (
        refreshedSeason &&
        (stuckProcessing || (options.forceCover && coverStatus === 'failed'))
      ) {
        refreshedSeason.seasonSetup = {
          ...(refreshedSeason.seasonSetup || {}),
          seasonCoverGenerationStatus: undefined,
        };
        refreshedSeason.updatedAt = new Date();
        await this.seasonsRepository.save(refreshedSeason);
      }
      await this.generateSeasonCoverInBackground(seasonId);
      coverGenerated = true;
    }

    const finalSeason = await this.seasonsRepository.findOne({ where: { seasonId } });
    const finalHero = await this.heroesRepository.findOne({ where: { seasonId } });

    return {
      seasonId,
      theme: finalSeason?.seasonSetup?.theme || null,
      heroReferenceImageUrl: this.mapStorageUrl(finalHero?.heroReferenceImageUrl),
      seasonCoverImageUrl: this.mapStorageUrl(finalSeason?.seasonSetup?.seasonCoverImageUrl),
      seasonCoverGenerationStatus: finalSeason?.seasonSetup?.seasonCoverGenerationStatus || null,
      heroGenerated,
      coverGenerated,
      skipped: !heroGenerated && !coverGenerated,
    };
  }

  async backfillAllSeasonVisuals(options: { forceFailedCovers?: boolean } = {}) {
    const seasons = await this.seasonsRepository.find({ order: { updatedAt: 'DESC' } });
    const results: Record<string, any>[] = [];

    for (const season of seasons) {
      const hero = await this.heroesRepository.findOne({ where: { seasonId: season.seasonId } });
      const missingHero = !hero?.heroReferenceImageUrl;
      const missingCover = !season.seasonSetup?.seasonCoverImageUrl;
      const failedCover =
        options.forceFailedCovers && season.seasonSetup?.seasonCoverGenerationStatus === 'failed';
      const stuckCover =
        season.seasonSetup?.seasonCoverGenerationStatus === 'processing' &&
        !season.seasonSetup?.seasonCoverImageUrl;

      if (!missingHero && !missingCover && !failedCover && !stuckCover) {
        results.push({
          seasonId: season.seasonId,
          theme: season.seasonSetup?.theme || null,
          skipped: true,
        });
        continue;
      }

      try {
        results.push(
          await this.backfillSeasonVisuals(season.seasonId, { forceCover: failedCover || missingCover }),
        );
      } catch (error) {
        results.push({
          seasonId: season.seasonId,
          theme: season.seasonSetup?.theme || null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      total: seasons.length,
      processed: results.filter((item) => !item.skipped && !item.error).length,
      skipped: results.filter((item) => item.skipped).length,
      failed: results.filter((item) => item.error).length,
      results,
    };
  }

  private async generateSeasonCoverInBackground(seasonId: string) {
    const existing = this.seasonCoverInFlight.get(seasonId);
    if (existing) {
      return existing;
    }

    const task = (async () => {
      try {
      const season = await this.seasonsRepository.findOne({ where: { seasonId } });
      const framework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
      const hero = await this.heroesRepository.findOne({ where: { seasonId } });
      if (!season || !framework || !hero?.heroReferenceImageUrl) {
        return;
      }

      const currentStatus = String(season.seasonSetup?.seasonCoverGenerationStatus || '');
      if (season.seasonSetup?.seasonCoverImageUrl || currentStatus === 'processing') {
        return;
      }

      season.seasonSetup = {
        ...(season.seasonSetup || {}),
        seasonCoverGenerationStatus: 'processing',
      };
      season.updatedAt = new Date();
      await this.seasonsRepository.save(season);

      const prompt = this.buildSeasonCoverPrompt(
        season.childProfile || {},
        season.seasonSetup || {},
        framework.framework || {},
        framework.seasonBible || {},
        hero.heroProfile || {},
        hero.heroVisualBrief || {},
      );
      const generation = await this.generateAndStoreIllustration(
        prompt,
        `images/seasons/${seasonId}/cover/season-cover.png`,
      );

      const refreshed = await this.seasonsRepository.findOne({ where: { seasonId } });
      if (!refreshed) {
        return;
      }

      refreshed.seasonSetup = {
        ...(refreshed.seasonSetup || {}),
        seasonCoverImageUrl: generation.imageUrl,
        seasonCoverGenerationStatus: 'ready',
      };
      refreshed.updatedAt = new Date();
      await this.seasonsRepository.save(refreshed);
      } catch (error) {
        const season = await this.seasonsRepository.findOne({ where: { seasonId } });
        if (season) {
          season.seasonSetup = {
            ...(season.seasonSetup || {}),
            seasonCoverGenerationStatus: 'failed',
          };
          season.updatedAt = new Date();
          await this.seasonsRepository.save(season);
        }
        this.logger.warn(
          `[SeasonCover] Failed to generate season cover for seasonId=${seasonId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })().finally(() => this.seasonCoverInFlight.delete(seasonId));

    this.seasonCoverInFlight.set(seasonId, task);
    return task;
  }

  private buildSeasonCoverPrompt(
    childProfile: Record<string, any>,
    seasonSetup: Record<string, any>,
    framework: Record<string, any>,
    seasonBible: Record<string, any>,
    heroProfile: Record<string, any>,
    heroVisualBrief: Record<string, any>,
  ) {
    const childName = String(childProfile?.childName || heroProfile?.name || 'Hero').trim();
    const worldTitle = String(seasonSetup?.storyWorld?.title || seasonSetup?.world || 'the story world').trim();
    const seasonPremise = String(framework?.seasonPremise || '').trim();
    const centralProblem = String(framework?.centralProblem || '').trim();
    const visualStyle = JSON.stringify(seasonBible?.illustrationStyleGuide || seasonBible?.illustrationStyle || {}, null, 2);

    return `Create an original polished 2D painted children's storybook season cover illustration.

This is a COVER image for a recurring season, not an episode frame and not a character sheet.

World:
- ${worldTitle}

Season premise:
- ${seasonPremise}

Central problem:
- ${centralProblem}

Hero profile:
${JSON.stringify(heroProfile, null, 2)}

Hero visual brief:
${JSON.stringify(heroVisualBrief, null, 2)}

Style guide:
${visualStyle}

Requirements:
- show the main child hero clearly and consistently with the reference look
- include a rich view of the season world/environment
- communicate wonder, adventure, and the main season mystery
- child-safe fantasy mood, warm polished storybook lighting
- composition should work as a season cover for home and library
- no text, no logo, no UI, no watermark
- not a collage, not a poster with labels, not multiple disconnected scenes
- no scary, violent, gory, sexualized, medical, political, or copyrighted franchise elements

The image should make ${childName}'s season feel personal, magical, and immediately recognizable.`;
  }

  private async getOrCreateHeroDraftDefaults(
    season: Season,
    framework: Record<string, any>,
    seasonBible: Record<string, any>,
  ) {
    const existingDefaults = season.storyState?.heroDraftDefaults;
    if (
      existingDefaults?.preferredName &&
      existingDefaults?.heroType &&
      existingDefaults?.companion &&
      existingDefaults?.favoriteColor &&
      existingDefaults?.accessory
    ) {
      return existingDefaults;
    }

    const generatedDefaults = await this.generateHeroDraftDefaults(
      season.childProfile || {},
      season.seasonSetup || {},
      framework || {},
      seasonBible || {},
    );

    season.storyState = {
      ...(season.storyState || {}),
      heroDraftDefaults: generatedDefaults,
    };
    season.updatedAt = new Date();
    await this.seasonsRepository.save(season);

    return generatedDefaults;
  }

  private async getOrCreateCrystalWallet(ownerUserId: string, seasonId?: string) {
    const ownerWallets = await this.crystalWalletsRepository.find({
      where: { ownerUserId },
      order: { createdAt: 'ASC' },
    });
    const now = new Date();

    let primaryWallet = ownerWallets[0];
    let createdInitialWallet = false;
    if (!primaryWallet) {
      if (!seasonId) {
        throw new Error(`Crystal wallet season context is required for first wallet creation: ${ownerUserId}`);
      }
      primaryWallet = this.crystalWalletsRepository.create({
        walletId: uuidv4(),
        ownerUserId,
        seasonId,
        balance: 0,
        createdAt: now,
        updatedAt: now,
      });
      ownerWallets.push(primaryWallet);
      createdInitialWallet = true;
    }

    const normalizedBalance = await this.computeOwnerCrystalBalance(ownerUserId);
    for (const wallet of ownerWallets) {
      wallet.ownerUserId = ownerUserId;
      wallet.seasonId = wallet.seasonId || seasonId || primaryWallet.seasonId;
      wallet.balance = normalizedBalance;
      wallet.updatedAt = now;
    }

    const savedWallets = await this.crystalWalletsRepository.save(ownerWallets);
    if (createdInitialWallet) {
      await this.crystalLedgerRepository.save(
        this.crystalLedgerRepository.create({
          ledgerEntryId: uuidv4(),
          walletId: savedWallets[0].walletId,
          ownerUserId,
          seasonId: savedWallets[0].seasonId,
          direction: 'credit',
          amount: INITIAL_CRYSTAL_GRANT,
          reason: 'initial_crystal_grant',
          metadata: { source: 'first_season', illustrationCredits: 3 },
          createdAt: now,
        }),
      );
      return this.getOrCreateCrystalWallet(ownerUserId, seasonId);
    }
    return savedWallets[0];
  }

  private async getIllustrationCrystalEligibility(ownerUserId: string, seasonId: string) {
    const wallet = await this.getOrCreateCrystalWallet(ownerUserId, seasonId);
    return {
      walletId: wallet.walletId,
      balance: wallet.balance,
      requiredCrystals: ILLUSTRATION_UNLOCK_COST,
      hasEnoughCrystals: wallet.balance >= ILLUSTRATION_UNLOCK_COST,
    };
  }

  private async computeOwnerCrystalBalance(ownerUserId: string) {
    const ledgerEntries = await this.crystalLedgerRepository.find({
      where: { ownerUserId },
      order: { createdAt: 'ASC' },
    });
    const recomputedBalance = ledgerEntries.reduce((sum, entry) => {
      const amount = Math.max(Number(entry.amount || 0), 0);
      return sum + (entry.direction === 'debit' ? -amount : amount);
    }, 0);
    return Math.max(recomputedBalance, 0);
  }

  private async appendCrystalLedgerEntry(
    ownerUserId: string,
    seasonId: string,
    direction: 'credit' | 'debit',
    amount: number,
    reason: string,
    metadata: Record<string, any>,
  ) {
    const normalizedAmount = Math.max(Number(amount || 0), 0);
    if (!normalizedAmount) {
      return this.getOrCreateCrystalWallet(ownerUserId, seasonId);
    }

    const wallet = await this.getOrCreateCrystalWallet(ownerUserId, seasonId);
    if (direction === 'debit' && wallet.balance < normalizedAmount) {
      throw new Error('Not enough crystals to unlock this illustration');
    }

    await this.crystalLedgerRepository.save(
      this.crystalLedgerRepository.create({
        ledgerEntryId: uuidv4(),
        walletId: wallet.walletId,
        ownerUserId,
        seasonId,
        direction,
        amount: normalizedAmount,
        reason,
        metadata,
        createdAt: new Date(),
      }),
    );

    return this.getOrCreateCrystalWallet(ownerUserId, seasonId);
  }

  private async debitIllustrationUnlockIfNeeded(
    ownerUserId: string,
    seasonId: string,
    episodeId: string,
    episodeNumber: number,
    illustrationId: string,
  ): Promise<boolean> {
    const netPaid = await this.getNetIllustrationUnlockPayment(ownerUserId, seasonId, episodeId);
    if (netPaid > 0) {
      return false;
    }

    await this.debitCrystals(ownerUserId, seasonId, ILLUSTRATION_UNLOCK_COST, 'illustration_unlock', {
      illustrationId: illustrationId || null,
      episodeId,
      episodeNumber,
    });
    return true;
  }

  private async getNetIllustrationUnlockPayment(
    ownerUserId: string,
    seasonId: string,
    episodeId: string,
  ): Promise<number> {
    const ledgerEntries = await this.crystalLedgerRepository.find({
      where: {
        seasonId,
        ownerUserId,
      },
      order: { createdAt: 'ASC' },
    });

    return ledgerEntries
      .filter(
        (entry) =>
          (entry.reason === 'illustration_unlock' || entry.reason === 'illustration_unlock_refund') &&
          entry.metadata?.episodeId === episodeId,
      )
      .reduce((sum, entry) => {
        const amount = Math.max(Number(entry.amount || 0), 0);
        return sum + (entry.direction === 'debit' ? amount : -amount);
      }, 0);
  }

  private async creditCrystals(
    ownerUserId: string,
    seasonId: string,
    amount: number,
    reason: string,
    metadata: Record<string, any>,
  ) {
    return this.appendCrystalLedgerEntry(ownerUserId, seasonId, 'credit', amount, reason, metadata);
  }

  private async debitCrystals(
    ownerUserId: string,
    seasonId: string,
    amount: number,
    reason: string,
    metadata: Record<string, any>,
  ) {
    return this.appendCrystalLedgerEntry(ownerUserId, seasonId, 'debit', amount, reason, metadata);
  }

  private async awardChoiceCrystals(
    ownerUserId: string,
    seasonId: string,
    episode: Episode,
    selectedChoice: Record<string, any>,
  ) {
    const amount = Math.max(Number(selectedChoice?.crystalReward ?? 1), 0);
    if (!amount) {
      return null;
    }

    return this.creditCrystals(ownerUserId, seasonId, amount, 'episode_choice_reward', {
      episodeId: episode.episodeId,
      episodeNumber: episode.episodeNumber,
      choiceId: selectedChoice?.id || '',
      choiceType: selectedChoice?.choiceType || '',
    });
  }

  private async enqueueIllustrationJob(
    seasonId: string,
    episode: Episode,
    illustrationId: string | null,
    storybookEntryId: string,
  ) {
    const jobHistory = await this.generationJobsRepository.find({
      where: {
        seasonId,
        episodeId: episode.episodeId,
        jobType: 'image_generation',
      },
      order: { updatedAt: 'DESC' },
    });
    const illustration = illustrationId
      ? await this.illustrationsRepository.findOne({ where: { illustrationId } })
      : null;
    if (
      illustration &&
      ['ready', 'ready_dry_run'].includes(illustration.status) &&
      illustration.imageUrl
    ) {
      const queuedJob = jobHistory.find((job) => job.status === 'pending');
      if (queuedJob) {
        queuedJob.status = 'skipped';
        queuedJob.result = {
          ...(queuedJob.result || {}),
          illustrationId,
          reason: 'illustration_already_ready',
        };
        queuedJob.updatedAt = new Date();
        await this.generationJobsRepository.save(queuedJob);
      }
      return jobHistory.find((job) => job.status === 'processing') || queuedJob || jobHistory[0] || illustration;
    }
    const activeJob = jobHistory.find((job) => job.status === 'pending' || job.status === 'processing');
    if (activeJob) {
      return activeJob;
    }
    if (jobHistory.length && !this.canScheduleRetry(jobHistory)) {
      return jobHistory[0];
    }

    if (illustration && illustration.status !== 'ready') {
      illustration.status = 'queued';
      illustration.updatedAt = new Date();
      await this.illustrationsRepository.save(illustration);
    }

    const entry = await this.storybookEntriesRepository.findOne({ where: { storybookEntryId } });
    if (entry && entry.status !== 'ready') {
      entry.status = 'queued';
      entry.updatedAt = new Date();
      await this.storybookEntriesRepository.save(entry);
    }

    const candidate = episode.illustrationCandidate || {};
    const now = new Date();
    return this.generationJobsRepository.save(
      this.generationJobsRepository.create({
        jobId: uuidv4(),
        seasonId,
        episodeId: episode.episodeId,
        jobType: 'image_generation',
        status: 'pending',
        payload: {
          illustrationId,
          storybookEntryId,
          lifecycle: this.buildJobLifecycle(jobHistory, now),
          promptPayload: {
            moment: candidate.moment,
            episodeNumber: episode.episodeNumber,
            episodeTitle: episode.title,
            chapterText: episode.chapterText,
            highlightedVocabulary: episode.highlightedVocabulary || [],
            sceneCharacters: candidate.sceneCharacters || [],
          },
        },
        result: {},
        error: null,
        promptVersion: 'illustration-v1',
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  private async enqueuePreparedNextEpisodeJobs(
    season: Season,
    framework: Record<string, any>,
    seasonBible: Record<string, any>,
    hero: Hero | null,
    sourceEpisode: Episode,
  ) {
    const nextEpisodeNumber = sourceEpisode.episodeNumber + 1;
    const seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId: season.seasonId } });
    const outlineItem =
      seasonFramework?.episodeOutline?.episodes?.find((item) => item.episodeNumber === nextEpisodeNumber) || null;

    if (!outlineItem || !Array.isArray(sourceEpisode.choices) || sourceEpisode.choices.length === 0) {
      return;
    }

    const now = new Date();

    for (const choice of sourceEpisode.choices) {
      const existingPrepared = await this.preparedEpisodesRepository.findOne({
        where: { sourceEpisodeId: sourceEpisode.episodeId, choiceId: choice.id },
      });
      if (existingPrepared) {
        continue;
      }

      const hypotheticalStoryState = this.applyStoryStateUpdate(
        season.storyState || {},
        sourceEpisode.storyStateDiff || {},
        choice,
        sourceEpisode,
      );
      const preparedEpisodeId = uuidv4();

      await this.preparedEpisodesRepository.save(
        this.preparedEpisodesRepository.create({
          preparedEpisodeId,
          seasonId: season.seasonId,
          sourceEpisodeId: sourceEpisode.episodeId,
          sourceEpisodeNumber: sourceEpisode.episodeNumber,
          choiceId: choice.id,
          nextEpisodeNumber,
          status: 'queued',
          payload: {
            sourceChoice: {
              id: choice.id,
              text: choice.text,
              choiceType: choice.choiceType,
            },
            nextOutlineItem: outlineItem,
            hypotheticalStoryState,
          },
          promptVersion: PREPARED_PLAN_PROMPT_VERSION,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    const existingPlanJob = await this.generationJobsRepository
      .createQueryBuilder('job')
      .where('job.seasonId = :seasonId', { seasonId: season.seasonId })
      .andWhere("job.jobType = 'prepared_branch_plan'")
      .andWhere("job.status IN ('pending', 'processing')")
      .andWhere("job.payload->>'sourceEpisodeId' = :sourceEpisodeId", {
        sourceEpisodeId: sourceEpisode.episodeId,
      })
      .getOne();
    if (existingPlanJob) {
      return;
    }

    await this.generationJobsRepository.save(
      this.generationJobsRepository.create({
        jobId: uuidv4(),
        seasonId: season.seasonId,
        episodeId: sourceEpisode.episodeId,
        jobType: 'prepared_branch_plan',
        status: 'pending',
        payload: {
          sourceEpisodeId: sourceEpisode.episodeId,
          sourceEpisodeNumber: sourceEpisode.episodeNumber,
          nextEpisodeNumber,
          outlineItem,
          framework,
          seasonBible,
          heroProfile: hero?.heroProfile || {},
          storyState: season.storyState || {},
        },
        result: {},
        error: null,
        promptVersion: PREPARED_PLAN_PROMPT_VERSION,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  private async generateStrategicSeasonFramework(
    protagonist: Record<string, any>,
    targetAudience: Record<string, any>,
    seasonSetup: Record<string, any>,
  ) {
    const ageLimit = String((Number(targetAudience.ageYears) || 6) + 3);
    const storyWorld = this.resolveStoryWorldContext(
      seasonSetup.storyDirection,
      seasonSetup.world,
      seasonSetup.storyWorld,
    );
    const { system, user } = this.prompts.buildPrompt('strategic-season-framework', {
      ageLimit,
      protagonistProfileJson: this.stringifyJson(protagonist),
      targetAudienceJson: this.stringifyJson(targetAudience),
      parentSettingsJson: this.buildParentSettingsJson(seasonSetup),
      theme: seasonSetup.theme || '',
      world: seasonSetup.world || '',
      storyWorldTitle: storyWorld?.title || seasonSetup.world || '',
      storyWorldDescription: storyWorld?.longDescription || '',
      storyWorldNotes: this.stringifyJson(storyWorld?.internalPromptNotes || []),
      storyWorldSuggestedThemes: this.stringifyJson(storyWorld?.suggestedThemes || []),
      storyWorldSuggestedVocabulary: this.stringifyJson(storyWorld?.suggestedVocabularyFocus || []),
      storyWorldAvoid: this.stringifyJson([
        'copying known IPs',
        'named franchises',
        'recognizable characters',
        'franchise-specific tropes',
        ...(storyWorld?.avoidNotes || []),
      ]),
      languageLevel: targetAudience.languageLevel || 'A1',
      vocabularyFocusJson: this.stringifyJson(seasonSetup.vocabularyFocus || []),
      safetyConstraintsJson: this.stringifyJson(['child-safe', 'no medical', 'no politics']),
      preferredTone: seasonSetup.preferredTone || '',
    });

    return this.generateSeasonJson(
      `${system}\n- The inciting incident and premise must be unique to the chosen world and setting. Do NOT use generic tropes like fog, mysterious sleep, characters randomly falling asleep, or waking up from a dream.`,
      user,
      { maxTokens: 4500 },
    );
  }

  private async generateSeasonBible(
    protagonist: Record<string, any>,
    seasonSetup: Record<string, any>,
    framework: Record<string, any>,
  ) {
    const { system, user } = this.prompts.buildPrompt('season-bible', {
      seasonFrameworkJson: this.stringifyJson(framework),
      protagonistProfileJson: this.stringifyJson(protagonist),
      parentSettingsJson: this.buildParentSettingsJson(seasonSetup),
      heroProfileJsonOrNull: this.stringifyJson(protagonist),
    });

    try {
      return await this.generateSeasonJson(system, user, { maxTokens: 5000 });
    } catch (error) {
      this.logGenerationFallback('Season bible', error);
      return this.buildFallbackSeasonBible(protagonist, seasonSetup, framework);
    }
  }

  private async generateEpisodeOutline(framework: Record<string, any>, seasonBible: Record<string, any>) {
    const { system, user } = this.prompts.buildPrompt('episode-outline', {
      seasonFrameworkJson: this.stringifyJson(framework),
      seasonBibleJson: this.stringifyJson(seasonBible),
      episodeCount: '96',
    });

    try {
      return await this.generateSeasonJson(system, user, { maxTokens: 30000, timeoutMs: 600000 });
    } catch (error) {
      this.logGenerationFallback('Episode outline', error);
      return this.buildFallbackEpisodeOutline(framework, seasonBible);
    }
  }

  private async generateHeroProfileAndVisualBrief(
    preferences: Record<string, any>,
    childProfile: Record<string, any>,
    seasonSetup: Record<string, any>,
    framework: Record<string, any>,
    seasonBible: Record<string, any>,
  ) {
    const { system, user } = this.prompts.buildPrompt('hero-profile', {
      heroPreferencesJson: this.stringifyJson(preferences),
      childProfileJson: this.stringifyJson(childProfile),
      seasonFrameworkJson: this.stringifyJson(framework),
      seasonBibleJson: this.stringifyJson(seasonBible),
      parentSettingsJson: this.buildParentSettingsJson(seasonSetup),
    });

    try {
      return await this.generateSeasonJson(system, user, { maxTokens: 4000 });
    } catch (error) {
      this.logGenerationFallback('Hero profile', error);
      return this.buildFallbackHero(preferences, framework, seasonSetup, childProfile);
    }
  }

  private async generateHeroDraftDefaults(
    childProfile: Record<string, any>,
    seasonSetup: Record<string, any>,
    framework: Record<string, any>,
    seasonBible: Record<string, any>,
  ) {
    const systemPrompt = `You are StoryHop's child-safe character concept assistant.
Generate concise default inputs for the hero setup form before the final hero is created.

Rules:
- Return valid JSON only.
- The defaults must feel specific to the current season's world, premise, and conflict.
- Make the hero appealing for a recurring children's protagonist.
- Keep every field short, concrete, and easy for a parent to edit.
- Avoid copyrighted characters, famous franchises, scary details, medical themes, politics, and violence.
- preferredName must use English letters only (Latin alphabet, optional space or hyphen, no Cyrillic).
- gender must be exactly one of: "boy", "girl", "ai_decides".
- Every parent-facing text field must be in Russian: heroType, companion, favoriteColor, accessory, appearanceRu, and descriptionRu. The only exception is preferredName, which must be Latin-only.
- Traits must be simple adjectives or short adjective phrases.
- Companion should be a short Russian creature or helper concept, not a full sentence.
- Favorite color must be a simple color phrase.
- Accessory must be a visible recurring object for illustrations.`;

    const userPrompt = `Create hero setup defaults for this season.

Child profile:
${JSON.stringify(childProfile, null, 2)}

Season setup:
${JSON.stringify(seasonSetup, null, 2)}

Strategic season framework:
${JSON.stringify(framework, null, 2)}

Season bible:
${JSON.stringify(seasonBible, null, 2)}

Parent-confirmed hero direction:
${JSON.stringify(childProfile?.heroDirection || {}, null, 2)}

If Parent-confirmed hero direction contains preferredName, use that exact spelling as preferredName and as the first name in descriptionRu. Do not substitute another name.
If it contains gender, age, traits, or description, the resulting descriptionRu must agree with those confirmed details. Do not invent a conflicting gender, age, or name.
When the parent confirms gender and age, set gender to that exact value and start descriptionRu with this exact identity: "<preferredName> — <age>-летний мальчик" for boy or "<preferredName> — <age>-летняя девочка" for girl. Do not use a gendered alternative such as "ученица" or "исследовательница" in place of this identity.
If Parent-confirmed hero direction contains a non-empty companion, preserve that companion. Otherwise generate a fresh, specific companion concept that fits the current world, the hero's age, gender, and traits; do not reuse a generic companion from an earlier profile.
If the parent supplied a Russian description, improve its clarity only while preserving all confirmed details. Include visible appearance, clothing or a signature object, a concrete personality-in-action detail, and the companion in the final descriptionRu. Do not merely list the form settings.
descriptionRu must be a detailed Russian paragraph of 260-520 characters. It must be useful as an editable parent-facing template, not a short summary.

Return JSON:
{
  "preferredName": "English hero name suggestion in Latin letters only",
  "gender": "boy, girl, or ai_decides",
  "heroType": "short Russian archetype",
  "traits": ["trait one", "trait two", "trait three"],
  "companion": "short Russian companion concept",
  "favoriteColor": "simple Russian color",
  "accessory": "short Russian visible accessory",
  "appearanceRu": "2-3 short Russian sentences about visible appearance, clothes, colors, signature object",
  "descriptionRu": "short Russian paragraph for the parent: who the hero is, what kind of personality they have, what they look like, and what companion idea fits them"
}`;

    try {
      const result = await this.generateSeasonJson(systemPrompt, userPrompt, {
        reasoning: { enabled: false },
        temperature: 0.35,
        maxTokens: 2600,
      });
      const draft = this.normalizeHeroDraftDefaults(result, childProfile);
      if (this.isUsableHeroDraft(draft, childProfile)) {
        this.logger.log(
          `[HeroPreview] primary profile accepted name=${draft.preferredName} descriptionLength=${draft.descriptionRu.length}`,
        );
        return draft;
      }

      this.logger.logInvalidLlmResponse(
        'Hero preview semantic validation (primary)',
        JSON.stringify(result),
        new Error(this.getHeroDraftValidationErrors(draft, childProfile).join('; ')),
      );

      this.logger.warn(
        '[Hero preview] Primary model returned an incomplete or non-Russian hero profile; retrying with the reserve model',
      );
      const repaired = await this.generateSeasonJson(
        `${systemPrompt}\nThe previous attempt was incomplete. Return a detailed Russian profile that satisfies every requested field.`,
        `${userPrompt}\n\nPrevious incomplete JSON:\n${JSON.stringify(result)}\n\nCreate a complete replacement JSON object.`,
        {
          model: this.openRouter.getSeasonFallbackModel(),
          reasoning: { enabled: false },
          temperature: 0.35,
          maxTokens: 2600,
        },
      );
      const repairedDraft = this.normalizeHeroDraftDefaults(repaired, childProfile);
      if (this.isUsableHeroDraft(repairedDraft, childProfile)) {
        this.logger.log(
          `[HeroPreview] reserve profile accepted name=${repairedDraft.preferredName} descriptionLength=${repairedDraft.descriptionRu.length}`,
        );
        return repairedDraft;
      }

      this.logger.logInvalidLlmResponse(
        'Hero preview semantic validation (reserve)',
        JSON.stringify(repaired),
        new Error(this.getHeroDraftValidationErrors(repairedDraft, childProfile).join('; ')),
      );

      throw new Error('Hero profile response is incomplete after reserve-model retry');
    } catch (error) {
      this.logger.logOpenRouterError('Hero preview', error);
      throw error;
    }
  }

  private normalizeHeroDraftDefaults(result: Record<string, any>, childProfile: Record<string, any>) {
    const heroDirection = childProfile?.heroDirection || {};
    const requestedName = String(heroDirection.preferredName || '').trim();
    const modelName = String(result?.preferredName || '').trim();
    const preferredName = requestedName || modelName;
    const modelDescription = String(result?.descriptionRu || result?.description || '').trim();
    const descriptionRu = requestedName
      ? this.normalizeHeroPreviewDescriptionName(modelDescription, requestedName)
      : modelDescription;
    const requestedTraits = Array.isArray(heroDirection.traits)
      ? heroDirection.traits.map((item: any) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : [];

    return {
      preferredName,
      gender: String(result?.gender || '').trim(),
      heroType: String(result?.heroType || '').trim(),
      traits: Array.isArray(result?.traits)
        ? result.traits.map((item: any) => String(item || '').trim()).filter(Boolean).slice(0, 3)
        : requestedTraits,
      companion: String(result?.companion || '').trim(),
      favoriteColor: String(result?.favoriteColor || '').trim(),
      accessory: String(result?.accessory || '').trim(),
      appearanceRu: String(result?.appearanceRu || '').trim(),
      descriptionRu,
    };
  }

  private isUsableHeroDraft(draft: Record<string, any>, childProfile: Record<string, any>) {
    return this.getHeroDraftValidationErrors(draft, childProfile).length === 0;
  }

  private getHeroDraftValidationErrors(draft: Record<string, any>, childProfile: Record<string, any>): string[] {
    const requestedName = String(childProfile?.heroDirection?.preferredName || '').trim();
    const requestedGender = String(childProfile?.heroDirection?.gender || 'ai_decides');
    const requestedAge = Number(childProfile?.heroDirection?.age);
    const englishName = /^[A-Za-z][A-Za-z' -]{0,39}$/;
    const containsCyrillic = (value: string) => /[\u0400-\u04FF]/u.test(value);
    const errors: string[] = [];
    const preferredName = String(draft.preferredName || '');
    const description = String(draft.descriptionRu || '');

    if (!englishName.test(preferredName)) errors.push('preferredName is not English-only');
    if (requestedName && preferredName !== requestedName) errors.push('preferredName conflicts with the parent-confirmed name');
    if (description.length < 260 || !containsCyrillic(description)) errors.push('descriptionRu is missing or not detailed Russian text');
    if (String(draft.companion || '').length < 8 || !containsCyrillic(String(draft.companion || ''))) errors.push('companion is missing or not Russian text');
    if (String(draft.appearanceRu || '').length < 80 || !containsCyrillic(String(draft.appearanceRu || ''))) errors.push('appearanceRu is missing or not Russian text');

    if (requestedGender === 'boy' || requestedGender === 'girl') {
      const expectedIdentity = requestedGender === 'boy'
        ? `${requestedAge}-летний мальчик`
        : `${requestedAge}-летняя девочка`;
      const expectedStart = new RegExp(
        `^\\s*${this.escapeRegExp(preferredName)}\\s*[-:—]\\s*${this.escapeRegExp(expectedIdentity)}(?:[,.\\s]|$)`,
        'u',
      );
      if (draft.gender !== requestedGender) errors.push('gender conflicts with the parent-confirmed gender');
      if (!expectedStart.test(description)) errors.push(`descriptionRu must start with "${preferredName} — ${expectedIdentity}"`);
    }

    return errors;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async generateHeroReferenceImage(heroProfile: Record<string, any>, heroVisualBrief: Record<string, any>) {
    const prompt = `Create a clean full-body character reference image for a recurring hero in a children's interactive story.

Hero profile:
${JSON.stringify(heroProfile, null, 2)}

Hero visual brief:
${JSON.stringify(heroVisualBrief, null, 2)}

Style:
- warm, polished children's book illustration
- friendly, expressive, age-appropriate
- full-body centered character
- simple light background
- clear silhouette
- consistent outfit and signature accessory
- no text, no logo, no watermark, no UI
- no scary, violent, sexualized, medical, political, or copyrighted elements

The image must be suitable as a visual consistency reference for future story illustrations.`;

    try {
      const result = await this.pixazo.generateImage(prompt);
      return result?.url || this.buildFallbackHeroReferenceImage(heroProfile, heroVisualBrief);
    } catch (error) {
      this.logGenerationFallback('Hero reference image', error);
      return this.buildFallbackHeroReferenceImage(heroProfile, heroVisualBrief);
    }
  }

  private async generateEpisodeContent(
    season: Season,
    framework: Record<string, any>,
    seasonBible: Record<string, any>,
    hero: Hero | null,
    outlineItem: Record<string, any>,
    currentStoryState: Record<string, any>,
    previousEpisodeSummary: string | null,
    selectedPreviousChoice: Record<string, any> | null,
    lockedPlan: Record<string, any> | null = null,
    excludedPreparedEpisodeId?: string,
  ) {
    const languageLevel = season.childProfile?.languageLevel || 'A1';
    const ageLimit = String((parseInt(season.childProfile?.childAge) || 6) + 3);
    const frameworkSlice = sliceFrameworkForEpisode(framework, outlineItem);
    const bibleSlice = sliceSeasonBibleForEpisode(seasonBible, outlineItem);
    const storyStateSlice = sliceStoryState(currentStoryState);
    const vocabularyTarget = buildVocabularyTarget(seasonBible, season.seasonSetup, outlineItem);
    const lockedPlanRules = lockedPlan
      ? '- You must follow lockedPlan exactly for scene goal, conflict, mustInclude, openingBeat, turningPoint, and endingHook.\n- Do not change the branch outcome. Expand the plan into final prose and JSON fields.'
      : '';
    const lockedPlanSection = lockedPlan
      ? `Locked branch plan:\n${this.stringifyJson(lockedPlan)}`
      : '';

    try {
      const usedSpeakingPhrases = await this.getUsedSpeakingPhrases(season.seasonId, excludedPreparedEpisodeId);
      const blockedSpeakingPhrases = [...usedSpeakingPhrases];

      for (let attempt = 1; attempt <= 3; attempt++) {
        const usedSpeakingPhrasesSection = blockedSpeakingPhrases.length > 0
          ? [
              'Do not reuse any of these phrases in speakingPrompt:',
              ...blockedSpeakingPhrases.map((phrase) => `- ${phrase}`),
              'Choose a different direct-speech line from the generated chapter.',
            ].join('\n')
          : 'No speaking phrases have been used in this season yet. Choose a natural direct-speech line from the chapter.';
        const { system, user } = this.prompts.buildPrompt('episode-content', {
          languageLevel,
          ageLimit,
          episodeMinWords: String(EPISODE_MIN_WORDS),
          episodeMaxWords: String(EPISODE_MAX_WORDS),
          seasonFrameworkJson: this.stringifyJson(frameworkSlice),
          seasonBibleJson: this.stringifyJson(bibleSlice),
          heroProfileJson: this.stringifyJson(hero?.heroProfile || { name: season.childProfile?.childName || 'Hero' }),
          episodeOutlineItemJson: this.stringifyJson(outlineItem),
          storyStateJson: this.stringifyJson(storyStateSlice),
          previousEpisodeSummaryOrNull: JSON.stringify(previousEpisodeSummary),
          selectedChoiceOrNull: JSON.stringify(selectedPreviousChoice),
          vocabularyTargetJson: this.stringifyJson(vocabularyTarget),
          usedSpeakingPhrasesSection,
          lockedPlanRules,
          lockedPlanSection,
        });
        const result = await this.generateJson(system, user);
        const usedPhraseKeys = new Set(blockedSpeakingPhrases.map((phrase) => this.normalizeSpeakingPhraseKey(phrase)));
        const uniquePrompt = this.pickUniqueSpeakingPrompt(
          String(result?.chapterText || ''),
          String(result?.speakingPrompt || ''),
          usedPhraseKeys,
        );

        if (uniquePrompt) {
          return {
            ...result,
            speakingPrompt: uniquePrompt,
            speakingPhraseKey: this.normalizeSpeakingPhraseKey(uniquePrompt),
          };
        }

        const duplicatePrompt = String(result?.speakingPrompt || '').trim();
        if (duplicatePrompt && !usedPhraseKeys.has(this.normalizeSpeakingPhraseKey(duplicatePrompt))) {
          blockedSpeakingPhrases.push(duplicatePrompt);
        }
      }

      throw new Error(`Episode generation returned no unique speaking phrase for season ${season.seasonId}`);
    } catch (error) {
      this.logGenerationFallback('Episode text', error);
      throw error;
    }
  }

  private async generatePreparedBranchPlan(
    sourceEpisode: Episode,
    framework: Record<string, any>,
    seasonBible: Record<string, any>,
    storyState: Record<string, any>,
    outlineItem: Record<string, any>,
    choiceBranches: Record<string, any>[],
  ) {
    const frameworkSlice = sliceFrameworkForEpisode(framework, outlineItem);
    const bibleSlice = sliceSeasonBibleForEpisode(seasonBible, outlineItem);
    const { system, user } = this.prompts.buildPrompt('prepared-next', {
      currentEpisodeJson: this.stringifyJson(summarizeEpisodeForPlan(sourceEpisode)),
      storyStateJson: this.stringifyJson(sliceStoryState(storyState)),
      choiceBranchesJson: this.stringifyJson(choiceBranches),
      seasonFrameworkJson: this.stringifyJson(frameworkSlice),
      seasonBibleJson: this.stringifyJson(bibleSlice),
      nextEpisodeOutlineItemJson: this.stringifyJson(outlineItem),
    });

    return this.generateJson(system, user);
  }

  private stringifyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  private buildParentSettingsJson(seasonSetup: Record<string, any>): string {
    return this.stringifyJson({
      preferredTone: seasonSetup.preferredTone || '',
      comments: seasonSetup.comments || '',
      vocabularyFocus: seasonSetup.vocabularyFocus || [],
      storyDirection: seasonSetup.storyDirection || null,
      storyWorld: seasonSetup.storyWorld || null,
    });
  }

  /**
   * The named protagonist is deliberately separate from the child account profile.
   * Generation must never confuse the account child's name with the story hero.
   */
  private buildSeasonProtagonistContext(season: Season): Record<string, any> {
    const direction = season.seasonSetup?.heroDirection || {};
    const pendingPreferences = season.storyState?.pendingHeroPreferences || {};
    const ageYears = Number(direction.age || pendingPreferences.ageYears || season.childProfile?.childAge) || 9;
    const name = String(direction.name || pendingPreferences.preferredName || 'Hero').trim();

    return {
      name,
      ageYears,
      gender: String(direction.gender || pendingPreferences.gender || 'ai_decides'),
      traits: Array.isArray(direction.traits)
        ? direction.traits.map((trait: unknown) => String(trait).trim()).filter(Boolean).slice(0, 4)
        : [],
      description: String(direction.description || pendingPreferences.description || '').trim(),
      companion: String(direction.companion || pendingPreferences.companion || '').trim(),
      languageLevel: season.childProfile?.languageLevel || 'A1',
    };
  }

  private buildSeasonTargetAudience(season: Season, protagonist: Record<string, any>): Record<string, any> {
    return {
      ageYears: Number(season.childProfile?.childAge) || Number(protagonist.ageYears) || 9,
      gender: season.childProfile?.childGender || 'ai_decides',
      languageLevel: season.childProfile?.languageLevel || 'A1',
    };
  }

  private async requireCompleteChildProfile(userId: string): Promise<ChildProfile> {
    const profile = await this.childProfilesRepository.findOne({ where: { userId } });
    if (!profile?.displayName?.trim() || !profile.age || !profile.gender || !profile.englishLevel) {
      throw new HttpException('profile_incomplete', 422);
    }
    return profile;
  }

  private mapChildProfile(profile: ChildProfile | null) {
    if (!profile) return null;
    return {
      complete: Boolean(profile.displayName?.trim() && profile.age && profile.gender && profile.englishLevel),
      displayName: profile.displayName,
      age: profile.age,
      gender: profile.gender,
      englishLevel: profile.englishLevel,
    };
  }

  private resolveStoryWorldContext(
    storyDirection?: Record<string, any> | null,
    worldTitle?: string | null,
    existingContext?: Record<string, any> | null,
  ) {
    if (existingContext?.id) {
      return existingContext;
    }
    return getStoryWorldPreset(storyDirection?.worldId, worldTitle) || null;
  }

  private async generateSeasonJson(
    systemPrompt: string,
    userPrompt: string,
    options?: JsonGenerationOptions,
  ) {
    return this.openRouter.generateSeasonJson(systemPrompt, userPrompt, options);
  }

  private async generateJson(systemPrompt: string, userPrompt: string) {
    return this.openRouter.generateJson(systemPrompt, userPrompt);
  }

  private getTtsSpeed(languageLevel?: string): number {
    const level = (languageLevel || '').toUpperCase();
    if (level.startsWith('A0')) return 0.75;
    if (level.startsWith('A1')) return 0.80;
    if (level.startsWith('A2')) return 0.85;
    return 0.90;
  }

  private async generateTtsAndUpload(text: string, storageKey: string, voice?: string, speed?: number) {
    if (!text?.trim()) {
      throw new Error('TTS job text is empty');
    }
    if (/[А-Яа-яЁё]/.test(text)) {
      throw new Error('TTS job contains Cyrillic text while Story language must be English');
    }
    const audioBuffer = await this.openRouter.generateTts(text, voice, speed);
    const normalized = this.audioMetadata.normalizeMp3(audioBuffer);
    const audioUrl = await this.storage.upload(storageKey, normalized.buffer, 'audio/mpeg');
    return { audioUrl, durationSeconds: normalized.durationSeconds };
  }

  /** Keep TTS/speech fragments English-only; drop Cyrillic without failing the season. */
  private toEnglishSpeechFragment(value: unknown, fallback = ''): string {
    const cleaned = String(value || '')
      .replace(/[\u0400-\u04FF]/gu, ' ')
      .replace(/["'«»„“”]\s*["'«»„“”]/g, ' ')
      .replace(/\(\s*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/^[,.!?;:\s]+|[,.!?;:\s]+$/g, '')
      .trim();
    return cleaned || fallback;
  }

  private buildStoryIntroSpeechText(
    hero: Hero,
    seasonSetup: Record<string, any>,
    framework: Record<string, any>,
  ): string {
    const name = this.toEnglishSpeechFragment(hero.heroProfile?.name, 'Hero');
    const storyWorld = this.resolveStoryWorldContext(
      seasonSetup?.storyDirection,
      seasonSetup?.world,
      seasonSetup?.storyWorld,
    );
    const world = this.toEnglishSpeechFragment(
      storyWorld?.title || seasonSetup?.world,
      'a magical world',
    );
    const title = `${name} and the world of ${world}`;
    const shortDescription = this.toEnglishSpeechFragment(
      String(hero.heroProfile?.shortDescription || '')
        .replace(new RegExp(`^${this.escapeRegExp(name)}\\s+is\\s+`, 'i'), '')
        .replace(/\.+$/, '')
        .trim(),
      'a brave hero',
    );
    const motivation = this.toEnglishSpeechFragment(
      String(hero.heroProfile?.motivation || '')
        .replace(new RegExp(`^${this.escapeRegExp(name)}\\s+wants\\s+`, 'i'), '')
        .replace(/\.+$/, '')
        .trim(),
      'to help friends',
    );
    const companionName = this.toEnglishSpeechFragment(
      hero.heroProfile?.companion?.name,
      'a friend',
    );
    const companionType = this.toEnglishSpeechFragment(
      hero.heroProfile?.companion?.type,
      'companion',
    );
    const premise = this.toEnglishSpeechFragment(framework?.seasonPremise);
    const centralProblem = this.toEnglishSpeechFragment(framework?.centralProblem);
    const paragraphs = [
      `This story begins in ${world}.${premise ? ` ${premise}` : ''}`.trim(),
      `${name} is ${shortDescription}. ${name} wants ${motivation}, and is joined by ${companionName}, a ${companionType}.`,
      centralProblem ? `But something is already changing: ${centralProblem}` : '',
    ].filter(Boolean);
    const introText = this.toEnglishSpeechFragment(
      `${title}. ${paragraphs.join('\n\n')}`,
      `${name} begins a new adventure.`,
    );
    return introText;
  }

  private async ensureStoryIntroAudioChunk(
    season: Season,
    hero: Hero,
    framework: Record<string, any>,
    episode: Episode,
  ): Promise<Episode> {
    if (episode.episodeNumber !== 1) {
      return episode;
    }

    try {
      const existingChunks = Array.isArray(episode.audioChunks) ? episode.audioChunks : [];
      const introText = this.buildStoryIntroSpeechText(hero, season.seasonSetup || {}, framework);
      const existingIntro = existingChunks.find((chunk) => chunk.type === 'story_intro');
      if (existingIntro?.text === introText && !/[\u0400-\u04FF]/u.test(String(existingIntro.text || ''))) {
        return episode;
      }

      const introChunk = {
        // A new ID prevents an old ready/failed job from being reused after a language repair.
        chunkId: uuidv4(),
        episodeId: episode.episodeId,
        type: 'story_intro',
        choiceId: null,
        text: introText,
        status: 'pending',
        audioUrl: null,
      };
      episode.audioChunks = [introChunk, ...existingChunks.filter((chunk) => chunk.type !== 'story_intro')];
      episode.generationStatus = this.getEpisodeAudioGenerationStatus(episode.audioChunks);
      episode.updatedAt = new Date();
      await this.episodesRepository.save(episode);
      await this.enqueueTtsJobs(
        season.seasonId,
        episode.episodeId,
        [introChunk],
        new Date(),
        season.childProfile?.languageLevel,
      );
      return episode;
    } catch (error) {
      this.logger.warn(
        `[StoryIntro] Skipping intro repair for season ${season.seasonId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return episode;
    }
  }

  private prepareAudioChunks(
    episodeId: string,
    episodeContent: Record<string, any>,
    prebuiltAudioChunks?: Record<string, any>[],
  ): Record<string, any>[] {
    if (Array.isArray(prebuiltAudioChunks) && prebuiltAudioChunks.length > 0) {
      return prebuiltAudioChunks.map((chunk) => ({
        chunkId: chunk.chunkId || uuidv4(),
        episodeId,
        type: chunk.type || 'chapter',
        choiceId: chunk.choiceId || null,
        partIndex: chunk.partIndex ?? null,
        text: chunk.text || '',
        status: chunk.status || 'pending',
        audioUrl: chunk.audioUrl || null,
      }));
    }

    const generatedChunks = Array.isArray(episodeContent.ttsChunks) ? episodeContent.ttsChunks : [];
    const fallbackChunks = [
      {
        type: 'chapter',
        text: episodeContent.chapterText || '',
      },
      {
        type: 'intro_options',
        text: episodeContent.introOptionsPhrase || '',
      },
      ...(Array.isArray(episodeContent.choices)
        ? episodeContent.choices.map((choice) => ({
            type: 'choice',
            choiceId: choice.id,
            text: choice.text,
          }))
        : []),
    ];
    const chunks = generatedChunks.length > 0 ? generatedChunks : fallbackChunks;

    const mapped = chunks
      .filter((chunk) => chunk?.text)
      .map((chunk) => ({
        chunkId: uuidv4(),
        episodeId,
        type: chunk.type || 'chapter',
        choiceId: chunk.choiceId || null,
        partIndex: chunk.partIndex ?? null,
        text: chunk.text,
        status: 'pending',
        audioUrl: null,
      }));

    return this.expandChapterAudioChunks(episodeId, mapped);
  }

  private async enqueueTtsJobs(
    seasonId: string,
    episodeId: string,
    audioChunks: Record<string, any>[],
    now: Date,
    languageLevel?: string,
    jobHistoryByChunk?: Map<string, GenerationJob[]>,
  ) {
    if (!audioChunks.length) {
      return;
    }

    const speed = this.getTtsSpeed(languageLevel);
    const jobs = audioChunks.map((chunk) =>
      this.generationJobsRepository.create({
        jobId: uuidv4(),
        seasonId,
        episodeId,
        jobType: 'tts_chunk',
        status: 'pending',
        payload: {
          lifecycle: this.buildJobLifecycle(jobHistoryByChunk?.get(String(chunk.chunkId || '')) || [], now),
          speed,
          model: process.env.OPENROUTER_TTS_MODEL || 'hexgrad/kokoro-82m',
          voice: process.env.OPENROUTER_TTS_VOICE || 'bm_lewis',
          format: 'mp3',
          text: chunk.text,
          metadata: {
            seasonId,
            episodeId,
            chunkId: chunk.chunkId,
            chunkType: chunk.type,
            partIndex: chunk.partIndex ?? null,
            choiceId: chunk.choiceId || null,
          },
        },
        result: {},
        error: null,
        promptVersion: TTS_JOB_PROMPT_VERSION,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.generationJobsRepository.save(jobs);
  }

  private async enqueuePreparedTtsJobs(
    seasonId: string,
    preparedEpisodeId: string,
    audioChunks: Record<string, any>[],
    now: Date,
    languageLevel?: string,
    jobHistoryByChunk?: Map<string, GenerationJob[]>,
  ) {
    if (!audioChunks.length) {
      return;
    }

    const speed = this.getTtsSpeed(languageLevel);
    const jobs = audioChunks.map((chunk) =>
      this.generationJobsRepository.create({
        jobId: uuidv4(),
        seasonId,
        episodeId: null,
        jobType: 'prepared_tts_chunk',
        status: 'pending',
        payload: {
          lifecycle: this.buildJobLifecycle(jobHistoryByChunk?.get(String(chunk.chunkId || '')) || [], now),
          speed,
          model: process.env.OPENROUTER_TTS_MODEL || 'hexgrad/kokoro-82m',
          voice: process.env.OPENROUTER_TTS_VOICE || 'bm_lewis',
          format: 'mp3',
          text: chunk.text,
          metadata: {
            seasonId,
            preparedEpisodeId,
            chunkId: chunk.chunkId,
            chunkType: chunk.type,
            partIndex: chunk.partIndex ?? null,
            choiceId: chunk.choiceId || null,
          },
        },
        result: {},
        error: null,
        promptVersion: TTS_JOB_PROMPT_VERSION,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.generationJobsRepository.save(jobs);
  }

  private async enqueuePreparedImageJob(
    seasonId: string,
    preparedEpisodeId: string,
    episodeContent: Record<string, any>,
    nextEpisodeNumber: number,
    hero: Hero | null,
    ownerUserId: string,
    now: Date,
  ) {
    const candidate = episodeContent?.illustrationCandidate || {};
    if (!candidate.shouldGenerate || !candidate.moment || !hero?.heroReferenceImageUrl) {
      return;
    }

    const preparedImageJobHistory = (await this.generationJobsRepository.find({
      where: { seasonId, jobType: 'prepared_image_generation' },
      order: { updatedAt: 'DESC' },
    })).filter((job) => String(job.payload?.preparedEpisodeId || '') === preparedEpisodeId);
    const existingJob = preparedImageJobHistory.find((job) => job.status === 'pending' || job.status === 'processing');
    if (existingJob) {
      return;
    }

    const prepared = await this.preparedEpisodesRepository.findOne({ where: { preparedEpisodeId } });
    const existingIllustration = prepared?.payload?.preparedIllustration;
    if (['ready', 'ready_dry_run'].includes(String(existingIllustration?.status || ''))) {
      return;
    }
    if (preparedImageJobHistory.length && !this.canScheduleRetry(preparedImageJobHistory)) {
      return;
    }

    const illustrationId = String(existingIllustration?.illustrationId || uuidv4());
    const eligibility = await this.getIllustrationCrystalEligibility(ownerUserId, seasonId);
    if (prepared) {
      prepared.payload = {
        ...(prepared.payload || {}),
        preparedIllustration: {
          illustrationId,
          status: eligibility.hasEnoughCrystals ? 'queued' : 'skipped_insufficient_crystals',
          moment: candidate.moment,
          sceneCharacters: candidate.sceneCharacters || episodeContent.sceneCharacters || [],
          requiredCrystals: eligibility.requiredCrystals,
          balanceAtDecision: eligibility.balance,
          reason: eligibility.hasEnoughCrystals ? null : 'insufficient_crystals',
        },
      };
      prepared.updatedAt = now;
      await this.preparedEpisodesRepository.save(prepared);
    }

    if (!eligibility.hasEnoughCrystals) {
      this.logPipelineStep('prepared_image_skipped_insufficient_crystals', {
        seasonId,
        preparedEpisodeId,
        illustrationId,
        nextEpisodeNumber,
        balance: eligibility.balance,
        requiredCrystals: eligibility.requiredCrystals,
      });
      return;
    }

    await this.generationJobsRepository.save(
      this.generationJobsRepository.create({
        jobId: uuidv4(),
        seasonId,
        episodeId: null,
        jobType: 'prepared_image_generation',
        status: 'pending',
        payload: {
          preparedEpisodeId,
          illustrationId,
          nextEpisodeNumber,
          lifecycle: this.buildJobLifecycle(preparedImageJobHistory, now),
          promptPayload: {
            moment: candidate.moment,
            episodeNumber: nextEpisodeNumber,
            episodeTitle: episodeContent.title || `Episode ${nextEpisodeNumber}`,
            chapterText: episodeContent.chapterText || '',
            highlightedVocabulary: episodeContent.highlightedVocabulary || [],
            sceneCharacters: candidate.sceneCharacters || episodeContent.sceneCharacters || [],
          },
        },
        result: {},
        error: null,
        promptVersion: PREPARED_IMAGE_PROMPT_VERSION,
        createdAt: now,
        updatedAt: now,
      }),
    );

    this.logPipelineStep('prepared_image_enqueued', {
      seasonId,
      preparedEpisodeId,
      illustrationId,
      nextEpisodeNumber,
    });
  }

  private normalizeEpisodeContent(
    episodeContent: Record<string, any>,
    outlineItem: Record<string, any>,
  ): Record<string, any> {
    const normalized = { ...episodeContent };
    const choiceIds = ['A', 'B'];
    let choices = Array.isArray(normalized.choices)
      ? normalized.choices
          .filter((choice) => choice && typeof choice.text === 'string' && choice.text.trim())
          .map((choice, index) => ({
            ...choice,
            id: choiceIds[index] || choice.id,
          }))
      : [];

    if (choices.length < 2) {
      const conflict = outlineItem?.conflict || 'the challenge ahead';
      if (choices.length === 0) {
        choices.push({
          id: 'A',
          text: `Move forward and face ${conflict}.`,
          translationRu: 'Продолжить путь вперёд.',
          choiceType: 'brave',
          crystalReward: 1,
          expectedStateDiff: {
            relationships: {},
            inventory: [],
            flags: [],
            seasonProgress: 'The hero takes direct action.',
          },
        });
      }

      choices.push({
        id: 'B',
        text: `Pause, listen carefully, and look for a safer way through ${conflict}.`,
        translationRu: 'Остановиться, прислушаться и найти более безопасный путь.',
        choiceType: 'clever',
        crystalReward: 1,
        expectedStateDiff: {
          relationships: {},
          inventory: [],
          flags: ['chose_careful_path'],
          seasonProgress: 'The hero chooses patience and teamwork.',
        },
      });

      this.logger.warn(
        `[Episode] Normalized choices: model returned ${Array.isArray(episodeContent.choices) ? episodeContent.choices.length : 0}, using ${choices.length}`,
      );
    }

    normalized.choices = choices.slice(0, 2).map((choice, index) => ({
      ...choice,
      id: choiceIds[index],
    }));

    const ttsChunks = Array.isArray(normalized.ttsChunks) ? [...normalized.ttsChunks] : [];
    const coveredChoiceIds = new Set(
      ttsChunks.filter((chunk) => chunk?.type === 'choice').map((chunk) => chunk.choiceId),
    );
    for (const choice of normalized.choices) {
      if (!coveredChoiceIds.has(choice.id)) {
        ttsChunks.push({ type: 'choice', choiceId: choice.id, text: choice.text });
      }
    }
    normalized.ttsChunks = ttsChunks.filter(
      (chunk) => chunk?.type !== 'choice' || choiceIds.includes(String(chunk.choiceId)),
    );

    return normalized;
  }

  private async createEpisodeRecord(
    seasonId: string,
    episodeNumber: number,
    outlineItem: Record<string, any>,
    episodeContent: Record<string, any>,
    prebuiltAudioChunks?: Record<string, any>[],
    languageLevel?: string,
    storyIntroText?: string | null,
    excludedPreparedEpisodeId?: string,
  ) {
    const normalizedContent = await this.ensureUniqueSpeakingPrompt(
      seasonId,
      this.normalizeEpisodeContent(episodeContent, outlineItem),
      excludedPreparedEpisodeId,
    );
    const episodeId = uuidv4();
    const now = new Date();
    let audioChunks = this.prepareAudioChunks(episodeId, normalizedContent, prebuiltAudioChunks);
    if (episodeNumber === 1 && storyIntroText) {
      audioChunks = [
        {
          chunkId: uuidv4(),
          episodeId,
          type: 'story_intro',
          choiceId: null,
          text: storyIntroText,
          status: 'pending',
          audioUrl: null,
        },
        ...audioChunks,
      ];
    }

    const createdEpisode = this.episodesRepository.create({
      episodeId,
      seasonId,
      episodeNumber,
      miniArcNumber: Number(outlineItem.miniArcNumber || 1),
      title: normalizedContent.title || outlineItem.title || `Episode ${episodeNumber}`,
      chapterText: normalizedContent.chapterText || '',
      speakingPrompt: normalizedContent.speakingPrompt || null,
      speakingPhraseKey: normalizedContent.speakingPhraseKey || null,
      introOptionsPhrase: normalizedContent.introOptionsPhrase || 'What should the hero do next?',
      highlightedVocabulary: Array.isArray(normalizedContent.highlightedVocabulary)
        ? normalizedContent.highlightedVocabulary
        : [],
      choices: Array.isArray(normalizedContent.choices) ? normalizedContent.choices : [],
      storyStateDiff: normalizedContent.storyStateDiff || {},
      illustrationCandidate: {
        ...(normalizedContent.illustrationCandidate || {}),
        sceneCharacters: Array.isArray(normalizedContent.sceneCharacters)
          ? normalizedContent.sceneCharacters
          : [],
      },
      audioChunks,
      generationStatus: this.getEpisodeAudioGenerationStatus(audioChunks),
      promptVersion: EPISODE_PROMPT_VERSION,
      createdAt: now,
      updatedAt: now,
    });

    await this.episodesRepository.save(createdEpisode);
    await this.enqueueTtsJobs(
      seasonId,
      episodeId,
      audioChunks.filter((chunk) => chunk.status === 'pending' || chunk.status === 'failed'),
      now,
      languageLevel,
    );
    return createdEpisode;
  }

  private buildInitialStoryState(
    protagonist: Record<string, any>,
    seasonSetup: Record<string, any>,
    framework: Record<string, any>,
  ) {
    return {
      seasonProgress: {
        currentMiniArc: 1,
        currentEpisodeNumber: 0,
        centralProblemStatus: 'not_started',
        dramaticQuestionProgress: framework.dramaticQuestion || '',
      },
      heroState: {
        childName: protagonist.name || 'Hero',
        languageLevel: protagonist.languageLevel || 'A1',
        activeWant: framework.heroWant || '',
        activeNeed: framework.heroNeed || '',
        emotionalState: 'curious',
        learnedLessons: [],
      },
      worldFacts: [
        framework.seasonPremise || '',
        framework.centralProblem || '',
        seasonSetup.world || '',
      ].filter(Boolean),
      relationships: {},
      inventory: [],
      openThreads: [framework.centralProblem || 'The season problem is still unresolved.'].filter(Boolean),
      resolvedThreads: [],
      vocabularyExposures: [],
      flags: ['season_initialized'],
    };
  }

  private async ensureStoryStateUsesCanonicalProtagonist(season: Season): Promise<Season> {
    const protagonist = this.buildSeasonProtagonistContext(season);
    if (!protagonist.name || protagonist.name === 'Hero') {
      return season;
    }

    const heroState = season.storyState?.heroState || {};
    if (
      heroState.childName === protagonist.name &&
      heroState.languageLevel === protagonist.languageLevel
    ) {
      return season;
    }

    season.storyState = {
      ...(season.storyState || {}),
      heroState: {
        ...heroState,
        childName: protagonist.name,
        languageLevel: protagonist.languageLevel,
      },
    };
    season.updatedAt = new Date();
    return this.seasonsRepository.save(season);
  }

  private applyStoryStateUpdate(
    previousStoryState: Record<string, any>,
    episodeStoryStateDiff: Record<string, any>,
    selectedChoice: Record<string, any>,
    episode: Episode,
  ) {
    const nextState = {
      ...previousStoryState,
      seasonProgress: {
        ...(previousStoryState.seasonProgress || {}),
        currentEpisodeNumber: episode.episodeNumber,
        centralProblemStatus:
          episodeStoryStateDiff.centralProblemProgress ||
          selectedChoice.expectedStateDiff?.seasonProgress ||
          previousStoryState.seasonProgress?.centralProblemStatus ||
          '',
      },
      heroState: {
        ...(previousStoryState.heroState || {}),
        emotionalState: selectedChoice.choiceType || previousStoryState.heroState?.emotionalState || 'curious',
      },
      relationships: {
        ...(previousStoryState.relationships || {}),
        ...(selectedChoice.expectedStateDiff?.relationships || {}),
      },
      inventory: [
        ...new Set([
          ...((previousStoryState.inventory as string[]) || []),
          ...((selectedChoice.expectedStateDiff?.inventory as string[]) || []),
        ]),
      ],
      worldFacts: [
        ...new Set([
          ...((previousStoryState.worldFacts as string[]) || []),
          ...((episodeStoryStateDiff.newFacts as string[]) || []),
        ]),
      ],
      openThreads: [
        ...new Set([
          ...((previousStoryState.openThreads as string[]) || []),
          episodeStoryStateDiff.centralProblemProgress || '',
        ].filter(Boolean)),
      ],
      resolvedThreads: [...((previousStoryState.resolvedThreads as string[]) || [])],
      flags: [
        ...new Set([
          ...((previousStoryState.flags as string[]) || []),
          ...((episodeStoryStateDiff.flags as string[]) || []),
          ...((selectedChoice.expectedStateDiff?.flags as string[]) || []),
        ]),
      ],
      vocabularyExposures: [
        ...((previousStoryState.vocabularyExposures as Record<string, any>[]) || []),
        ...((episode.highlightedVocabulary || []).map((item) => ({
          term: item.term,
          exposureCountDelta: 1,
          context: `episode_${episode.episodeNumber}_${selectedChoice.id}`,
        })) as Record<string, any>[]),
      ],
      lastChoice: {
        episodeId: episode.episodeId,
        episodeNumber: episode.episodeNumber,
        choiceId: selectedChoice.id,
        choiceText: selectedChoice.text,
        choiceType: selectedChoice.choiceType,
      },
    };

    nextState.seasonProgress = {
      ...(nextState.seasonProgress || {}),
      currentEpisodeNumber: episode.episodeNumber,
      dramaticQuestionProgress:
        nextState.seasonProgress?.dramaticQuestionProgress ||
        previousStoryState.seasonProgress?.dramaticQuestionProgress ||
        '',
    };

    return nextState;
  }

  private buildPreviousEpisodeSummary(episode: Episode) {
    return `${episode.title}: ${episode.chapterText}`.slice(0, 500);
  }

  private async claimPendingJob(job: GenerationJob): Promise<boolean> {
    const claimResult = await this.generationJobsRepository
      .createQueryBuilder()
      .update(GenerationJob)
      .set({
        status: 'processing',
        updatedAt: new Date(),
      })
      .where({
        jobId: job.jobId,
        status: 'pending',
      })
      .execute();

    if (!claimResult.affected) {
      return false;
    }

    job.status = 'processing';
    job.updatedAt = new Date();
    return true;
  }

  private async processSeasonTitleJob(job: GenerationJob, dryRun: boolean) {
    const claimed = await this.claimPendingJob(job);
    if (!claimed) {
      return { jobId: job.jobId, status: 'skipped' };
    }

    try {
      const [season, seasonFramework] = await Promise.all([
        this.seasonsRepository.findOne({ where: { seasonId: job.seasonId } }),
        this.seasonFrameworksRepository.findOne({ where: { seasonId: job.seasonId } }),
      ]);
      if (!season || !seasonFramework) {
        throw new Error('Season or framework for title job was not found');
      }

      const existingTitle = this.getCanonicalSeasonTitle(season, seasonFramework);
      if (existingTitle) {
        job.status = 'ready';
        job.result = { title: existingTitle, skipped: true };
        job.error = null;
        job.updatedAt = new Date();
        await this.generationJobsRepository.save(job);
        return { jobId: job.jobId, status: 'ready', title: existingTitle, skipped: true };
      }

      const protagonist = this.buildSeasonProtagonistContext(season);
      const { system, user } = this.prompts.buildPrompt('season-title', {
        seasonFrameworkJson: this.stringifyJson(seasonFramework.framework || {}),
        storyWorld: String(
          season.seasonSetup?.storyWorld?.title || season.seasonSetup?.world || '',
        ),
        protagonistProfileJson: this.stringifyJson(protagonist),
      });
      const generated = dryRun
        ? { title: 'The Waiting Compass' }
        : await this.generateSeasonJson(system, user, {
            reasoning: { enabled: false },
            temperature: 0.3,
            maxTokens: 300,
          });
      const title = String(generated?.title || '').trim();
      if (!this.isUsableSeasonTitle(title)) {
        throw new Error('Season title response is missing or violates the title contract');
      }

      seasonFramework.framework = {
        ...(seasonFramework.framework || {}),
        title,
      };
      seasonFramework.updatedAt = new Date();
      await this.seasonFrameworksRepository.save(seasonFramework);

      job.status = dryRun ? 'ready_dry_run' : 'ready';
      job.result = { title };
      job.error = null;
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);
      this.logger.log(`[SeasonTitle] ready seasonId=${job.seasonId} jobId=${job.jobId} title=${title}`);
      return { jobId: job.jobId, status: job.status, title };
    } catch (error) {
      job.status = 'failed';
      job.payload = {
        ...(job.payload || {}),
        attemptCount: Number(job.payload?.attemptCount || 0) + 1,
      };
      job.error = this.formatGenerationError(error);
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);
      this.logger.logOpenRouterError('Season title', error);
      return { jobId: job.jobId, status: job.status, error: job.error };
    }
  }

  private async processTtsJob(job: GenerationJob, dryRun: boolean) {
    const claimed = await this.claimPendingJob(job);
    if (!claimed) {
      return {
        jobId: job.jobId,
        status: 'skipped',
      };
    }

    try {
      const payload = job.payload || {};
      const metadata = payload.metadata || {};
      const episode = job.episodeId
        ? await this.episodesRepository.findOne({ where: { episodeId: job.episodeId } })
        : null;

      if (!episode) {
        throw new Error('Episode for TTS job was not found');
      }

      const voice = payload.voice || undefined;
      const speed = typeof payload.speed === 'number' ? payload.speed : undefined;
      const audio = dryRun
        ? { audioUrl: this.buildDryRunAudioUrl(metadata.chunkId || job.jobId), durationSeconds: 0 }
        : await this.generateTtsAndUpload(
            payload.text || '',
            `audio/seasons/${job.seasonId}/${episode.episodeId}/${metadata.chunkId || job.jobId}.mp3`,
            voice,
            speed,
          );
      await this.persistEpisodeTtsResult(job, episode.episodeId, metadata, audio.audioUrl, audio.durationSeconds, dryRun);

      return {
        jobId: job.jobId,
        status: dryRun ? 'ready_dry_run' : 'ready',
        audioUrl: audio.audioUrl,
      };
    } catch (error) {
      job.status = 'failed';
      job.error = this.formatGenerationError(error);
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);

      return {
        jobId: job.jobId,
        status: job.status,
        error: job.error,
      };
    }
  }

  private async processIllustrationJob(job: GenerationJob, dryRun: boolean) {
    const pipelineStartedAt = Date.now();
    const claimed = await this.claimPendingJob(job);
    if (!claimed) {
      return {
        jobId: job.jobId,
        status: 'skipped',
      };
    }
    this.logPipelineStep('illustration_job_started', {
      seasonId: job.seasonId,
      jobId: job.jobId,
      episodeId: job.episodeId,
      dryRun,
    });

    try {
      const payload = job.payload || {};
      const illustrationId = String(payload.illustrationId || '');
      const storybookEntryId = String(payload.storybookEntryId || '');
      const illustration = await this.illustrationsRepository.findOne({ where: { illustrationId } });
      const entry = await this.storybookEntriesRepository.findOne({ where: { storybookEntryId } });
      const seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId: job.seasonId } });
      const hero = await this.heroesRepository.findOne({ where: { seasonId: job.seasonId } });

      if (!illustration || !entry || !seasonFramework || !hero) {
        throw new Error('Illustration job dependencies were not found');
      }

      if (['ready', 'ready_dry_run'].includes(illustration.status) && illustration.imageUrl) {
        job.status = 'skipped';
        job.result = {
          illustrationId,
          imageUrl: illustration.imageUrl,
          reason: 'illustration_already_ready',
        };
        job.updatedAt = new Date();
        await this.generationJobsRepository.save(job);
        this.logPipelineStep('illustration_generation_skipped_ready', {
          seasonId: job.seasonId,
          jobId: job.jobId,
          episodeId: job.episodeId,
          illustrationId,
        });
        return { jobId: job.jobId, status: job.status, reason: 'illustration_already_ready' };
      }

      const generation = dryRun
        ? { imageUrl: this.buildDryRunImageUrl(illustrationId), ttiPrompt: null, requestId: null }
        : await this.generateEpisodeIllustrationAndUpload(
            job.seasonId,
            payload.episodeId || illustration.episodeId,
            illustrationId,
            seasonFramework.framework || {},
            seasonFramework.seasonBible || {},
            hero,
            payload.promptPayload || illustration.promptPayload || {},
            `images/seasons/${job.seasonId}/storybook/${illustrationId}.png`,
            { recoveryRequestId: payload.recoveryRequestId || null },
          );
      const imageUrl = generation.imageUrl;

      illustration.status = dryRun ? 'ready_dry_run' : 'ready';
      illustration.imageUrl = imageUrl;
      illustration.promptPayload = {
        ...(illustration.promptPayload || {}),
        providerRequestId: generation.requestId || null,
      };
      illustration.updatedAt = new Date();
      await this.illustrationsRepository.save(illustration);

      if (entry.status !== 'locked') {
        entry.status = dryRun ? 'ready_dry_run' : 'ready';
      }
      entry.updatedAt = new Date();
      await this.storybookEntriesRepository.save(entry);

      job.status = dryRun ? 'ready_dry_run' : 'ready';
      job.result = {
        illustrationId,
        imageUrl,
        dryRun,
        ttiPrompt: generation.ttiPrompt,
        requestId: generation.requestId || null,
      };
      job.error = null;
      job.payload = {
        ...(job.payload || {}),
        recoveryRequestId: null,
      };
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);
      this.logPipelineStep('illustration_job_ready', {
        seasonId: job.seasonId,
        jobId: job.jobId,
        episodeId: job.episodeId,
        illustrationId,
        durationMs: Date.now() - pipelineStartedAt,
        dryRun,
      });

      return {
        jobId: job.jobId,
        status: job.status,
        imageUrl,
      };
    } catch (error) {
      this.recordPixazoFailure();
      this.logPipelineStep('illustration_job_failed', {
        seasonId: job.seasonId,
        jobId: job.jobId,
        episodeId: job.episodeId,
        durationMs: Date.now() - pipelineStartedAt,
        error: this.formatGenerationError(error),
      });
      const payload = job.payload || {};
      const illustrationId = String(payload.illustrationId || '');
      const storybookEntryId = String(payload.storybookEntryId || '');
      const illustration = illustrationId
        ? await this.illustrationsRepository.findOne({ where: { illustrationId } })
        : null;
      const entry = storybookEntryId
        ? await this.storybookEntriesRepository.findOne({ where: { storybookEntryId } })
        : null;

      if (illustration) {
        illustration.status = 'failed';
        illustration.promptPayload = {
          ...(illustration.promptPayload || {}),
          providerRequestId: this.extractPixazoRequestId(error) || illustration.promptPayload?.providerRequestId || null,
        };
        illustration.updatedAt = new Date();
        await this.illustrationsRepository.save(illustration);
      }

      if (entry) {
        entry.status = 'failed';
        entry.updatedAt = new Date();
        await this.storybookEntriesRepository.save(entry);
      }

      if (illustrationId || job.episodeId) {
        await this.refundIllustrationUnlockIfNeeded(job, illustrationId, job.episodeId || null);
      }

      job.status = 'failed';
      job.error = this.formatGenerationError(error);
      job.payload = {
        ...(job.payload || {}),
        recoveryRequestId: this.extractPixazoRequestId(error) || job.payload?.recoveryRequestId || null,
      };
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);

      return {
        jobId: job.jobId,
        status: job.status,
        error: job.error,
      };
    }
  }

  private async processPreparedImageJob(job: GenerationJob, dryRun: boolean) {
    const pipelineStartedAt = Date.now();
    const claimed = await this.claimPendingJob(job);
    if (!claimed) {
      return {
        jobId: job.jobId,
        status: 'skipped',
      };
    }

    const preparedEpisodeId = String(job.payload?.preparedEpisodeId || '');
    const cancelled = await this.abortJobIfPreparedCancelled(job, preparedEpisodeId);
    if (cancelled) {
      return cancelled;
    }
    this.logPipelineStep('prepared_image_job_started', {
      seasonId: job.seasonId,
      jobId: job.jobId,
      preparedEpisodeId,
      dryRun,
    });

    try {
      const payload = job.payload || {};
      const prepared = await this.preparedEpisodesRepository.findOne({ where: { preparedEpisodeId } });
      const seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId: job.seasonId } });
      const hero = await this.heroesRepository.findOne({ where: { seasonId: job.seasonId } });

      if (!prepared || !seasonFramework || !hero) {
        throw new Error('Prepared image job dependencies were not found');
      }

      const existingIllustration = prepared.payload?.preparedIllustration;
      if (
        ['ready', 'ready_dry_run'].includes(String(existingIllustration?.status || '')) &&
        existingIllustration?.imageUrl
      ) {
        await this.attachPreparedIllustrationToUsedEpisode(job.seasonId, prepared, hero);
        job.status = 'skipped';
        job.result = {
          preparedEpisodeId,
          illustrationId: existingIllustration.illustrationId,
          imageUrl: existingIllustration.imageUrl,
          reason: 'prepared_illustration_already_ready',
        };
        job.updatedAt = new Date();
        await this.generationJobsRepository.save(job);
        this.logPipelineStep('prepared_illustration_generation_skipped_ready', {
          seasonId: job.seasonId,
          jobId: job.jobId,
          preparedEpisodeId,
          illustrationId: existingIllustration.illustrationId,
        });
        return { jobId: job.jobId, status: job.status, reason: 'prepared_illustration_already_ready' };
      }

      const episodeContent = prepared.payload?.episodeContent || {};
      const candidate = episodeContent.illustrationCandidate || {};
      if (!candidate.shouldGenerate || !candidate.moment) {
        throw new Error('Prepared episode has no illustration candidate');
      }

      const illustrationId = String(payload.illustrationId || prepared.payload?.preparedIllustration?.illustrationId || uuidv4());
      const promptPayload = payload.promptPayload || {
        moment: candidate.moment,
        episodeNumber: prepared.nextEpisodeNumber,
        episodeTitle: episodeContent.title || `Episode ${prepared.nextEpisodeNumber}`,
        chapterText: episodeContent.chapterText || '',
        highlightedVocabulary: episodeContent.highlightedVocabulary || [],
        sceneCharacters: candidate.sceneCharacters || episodeContent.sceneCharacters || [],
      };
      const storageKey = `images/seasons/${job.seasonId}/prepared/${preparedEpisodeId}/${illustrationId}.png`;

      await this.syncSeasonCharactersFromEpisode(
        job.seasonId,
        seasonFramework.seasonBible || {},
        hero,
        episodeContent,
      );

      const generation = dryRun
        ? { imageUrl: this.buildDryRunImageUrl(illustrationId), ttiPrompt: null, requestId: null }
        : await this.generateEpisodeIllustrationAndUpload(
            job.seasonId,
            null,
            illustrationId,
            seasonFramework.framework || {},
            seasonFramework.seasonBible || {},
            hero,
            promptPayload,
            storageKey,
            {
              moderationRetryMode: 'same_prompt_only',
              recoveryRequestId: payload.recoveryRequestId || null,
            },
          );


      prepared.payload = {
        ...(prepared.payload || {}),
        preparedIllustration: {
          illustrationId,
          imageUrl: generation.imageUrl,
          status: dryRun ? 'ready_dry_run' : 'ready',
          providerRequestId: generation.requestId || null,
          promptPayload: {
            ...promptPayload,
            ttiPrompt: generation.ttiPrompt,
          },
          storageKey,
        },
      };
      prepared.updatedAt = new Date();
      await this.preparedEpisodesRepository.save(prepared);

      await this.attachPreparedIllustrationToUsedEpisode(job.seasonId, prepared, hero);

      job.status = dryRun ? 'ready_dry_run' : 'ready';
      job.result = {
        preparedEpisodeId,
        illustrationId,
        imageUrl: generation.imageUrl,
        dryRun,
        ttiPrompt: generation.ttiPrompt,
        requestId: generation.requestId || null,
      };
      job.error = null;
      job.payload = {
        ...(job.payload || {}),
        recoveryRequestId: null,
      };
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);
      this.logPipelineStep('prepared_image_job_ready', {
        seasonId: job.seasonId,
        jobId: job.jobId,
        preparedEpisodeId,
        illustrationId,
        durationMs: Date.now() - pipelineStartedAt,
        dryRun,
      });

      return {
        jobId: job.jobId,
        status: job.status,
        imageUrl: generation.imageUrl,
      };
    } catch (error) {
      const prepared = preparedEpisodeId
        ? await this.preparedEpisodesRepository.findOne({ where: { preparedEpisodeId } })
        : null;
      if (prepared?.payload?.preparedIllustration) {
        prepared.payload = {
          ...(prepared.payload || {}),
          preparedIllustration: {
            ...(prepared.payload.preparedIllustration || {}),
            status: 'failed',
            providerRequestId:
              this.extractPixazoRequestId(error) ||
              prepared.payload.preparedIllustration?.providerRequestId ||
              null,
          },
        };
        prepared.updatedAt = new Date();
        await this.preparedEpisodesRepository.save(prepared);
      }

      job.status = 'failed';
      job.error = this.formatGenerationError(error);
      job.payload = {
        ...(job.payload || {}),
        recoveryRequestId: this.extractPixazoRequestId(error) || job.payload?.recoveryRequestId || null,
      };
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);
      this.recordPixazoFailure();
      this.logPipelineStep('prepared_image_job_failed', {
        seasonId: job.seasonId,
        jobId: job.jobId,
        preparedEpisodeId,
        durationMs: Date.now() - pipelineStartedAt,
        error: job.error,
      });

      return {
        jobId: job.jobId,
        status: job.status,
        error: job.error,
      };
    }
  }

  private async processPreparedBranchPlanJob(job: GenerationJob, dryRun: boolean) {
    const claimed = await this.claimPendingJob(job);
    if (!claimed) {
      return {
        jobId: job.jobId,
        status: 'skipped',
      };
    }
    const now = new Date();

    try {
      const payload = job.payload || {};
      const sourceEpisodeId = String(payload.sourceEpisodeId || '');
      const sourceEpisode = await this.episodesRepository.findOne({ where: { episodeId: sourceEpisodeId } });
      const season = await this.seasonsRepository.findOne({ where: { seasonId: job.seasonId } });
      if (!sourceEpisode || !season) {
        throw new Error('Prepared branch plan dependencies were not found');
      }

      const existingChoice = await this.episodeChoicesRepository.findOne({ where: { episodeId: sourceEpisodeId } });
      if (existingChoice) {
        await this.cancelUnusedPreparedBranches(job.seasonId, sourceEpisodeId, existingChoice.choiceId);
        job.status = 'cancelled';
        job.error = 'cancelled: source episode choice already applied';
        job.updatedAt = new Date();
        await this.generationJobsRepository.save(job);
        return {
          jobId: job.jobId,
          status: 'cancelled',
          reason: 'choice_already_applied',
        };
      }

      const preparedRows = await this.preparedEpisodesRepository.find({
        where: { seasonId: job.seasonId, sourceEpisodeId },
      });
      const choiceBranches = preparedRows.map((row) => ({
        choiceId: row.choiceId,
        choice: row.payload?.sourceChoice || {},
        hypotheticalStoryState: row.payload?.hypotheticalStoryState || {},
      }));

      const planResult = dryRun
        ? {
            candidates: preparedRows.map((row) => ({
              choiceId: row.choiceId,
              branchSummary: `Fallback branch for choice ${row.choiceId}`,
              stateDiffPreview: {},
              episodeDraftPlan: {
                title: `Episode ${payload.nextEpisodeNumber}`,
                sceneGoal: 'Continue the adventure',
                conflict: 'A small obstacle appears',
                mustInclude: ['hero action'],
                vocabularyFocus: [],
                openingBeat: 'The hero moves forward',
                turningPoint: 'A helper appears',
                endingHook: 'A new choice waits',
              },
            })),
          }
        : await this.generatePreparedBranchPlan(
            sourceEpisode,
            payload.framework || {},
            payload.seasonBible || {},
            payload.storyState || {},
            payload.outlineItem || {},
            choiceBranches,
          );

      const candidates = Array.isArray(planResult?.candidates) ? planResult.candidates : [];
      for (const candidate of candidates) {
        const prepared = preparedRows.find((row) => row.choiceId === candidate.choiceId);
        if (!prepared || prepared.status === 'cancelled') {
          continue;
        }

        prepared.status = 'plan_ready';
        prepared.payload = {
          ...(prepared.payload || {}),
          branchSummary: candidate.branchSummary || '',
          stateDiffPreview: candidate.stateDiffPreview || {},
          episodeDraftPlan: candidate.episodeDraftPlan || {},
          planGeneratedAt: new Date().toISOString(),
        };
        prepared.updatedAt = new Date();
        await this.preparedEpisodesRepository.save(prepared);

        const existingProseJob = await this.generationJobsRepository
          .createQueryBuilder('job')
          .where('job.seasonId = :seasonId', { seasonId: job.seasonId })
          .andWhere("job.jobType = 'prepared_episode_prose'")
          .andWhere("job.status IN ('pending', 'processing')")
          .andWhere("job.payload->>'preparedEpisodeId' = :preparedEpisodeId", {
            preparedEpisodeId: prepared.preparedEpisodeId,
          })
          .getOne();
        if (existingProseJob) {
          continue;
        }

        await this.generationJobsRepository.save(
          this.generationJobsRepository.create({
            jobId: uuidv4(),
            seasonId: job.seasonId,
            episodeId: sourceEpisodeId,
            jobType: 'prepared_episode_prose',
            status: 'pending',
            payload: {
              preparedEpisodeId: prepared.preparedEpisodeId,
              nextEpisodeNumber: prepared.nextEpisodeNumber,
              sourceEpisodeId,
              sourceEpisodeNumber: sourceEpisode.episodeNumber,
              selectedChoice: {
                id: prepared.payload?.sourceChoice?.id || prepared.choiceId,
                text: prepared.payload?.sourceChoice?.text || '',
                choiceType: prepared.payload?.sourceChoice?.choiceType || '',
                seasonProgress: '',
              },
              previousEpisodeSummary: this.buildPreviousEpisodeSummary(sourceEpisode),
              outlineItem: payload.outlineItem || prepared.payload?.nextOutlineItem || {},
              hypotheticalStoryState: prepared.payload?.hypotheticalStoryState || {},
              framework: payload.framework || {},
              seasonBible: payload.seasonBible || {},
              heroProfile: payload.heroProfile || {},
              episodeDraftPlan: candidate.episodeDraftPlan || {},
            },
            result: {},
            error: null,
            promptVersion: PREPARED_PROSE_PROMPT_VERSION,
            createdAt: now,
            updatedAt: now,
          }),
        );
      }

      job.status = 'ready';
      job.result = { candidateCount: candidates.length, dryRun };
      job.error = null;
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);

      return { jobId: job.jobId, status: job.status, candidateCount: candidates.length };
    } catch (error) {
      job.status = 'failed';
      job.error = this.formatGenerationError(error);
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);
      return { jobId: job.jobId, status: job.status, error: job.error };
    }
  }

  private async processPreparedEpisodeProseJob(job: GenerationJob, dryRun: boolean) {
    const claimed = await this.claimPendingJob(job);
    if (!claimed) {
      return {
        jobId: job.jobId,
        status: 'skipped',
      };
    }

    try {
      const payload = job.payload || {};
      const preparedEpisodeId = String(payload.preparedEpisodeId || '');
      const cancelled = await this.abortJobIfPreparedCancelled(job, preparedEpisodeId);
      if (cancelled) {
        return cancelled;
      }
      const prepared = await this.preparedEpisodesRepository.findOne({ where: { preparedEpisodeId } });
      const season = await this.seasonsRepository.findOne({ where: { seasonId: job.seasonId } });
      const hero = await this.heroesRepository.findOne({ where: { seasonId: job.seasonId } });

      if (!prepared || !season) {
        throw new Error('Prepared episode prose dependencies were not found');
      }
      if (prepared.status === 'cancelled') {
        return (await this.abortJobIfPreparedCancelled(job, preparedEpisodeId)) || {
          jobId: job.jobId,
          status: 'cancelled',
        };
      }

      const lockedPlan = payload.episodeDraftPlan || prepared.payload?.episodeDraftPlan || null;
      if (dryRun) {
        throw new Error('Dry-run prepared episode prose is disabled: episode text must come from the model or fail explicitly.');
      }

      let episodeContent: Record<string, any> | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= PREPARED_EPISODE_PROSE_MAX_ATTEMPTS; attempt++) {
        try {
          episodeContent = await this.generateEpisodeContent(
            season,
            payload.framework || {},
            payload.seasonBible || {},
            hero,
            payload.outlineItem || {},
            payload.hypotheticalStoryState || {},
            payload.previousEpisodeSummary || null,
            payload.selectedChoice || null,
            lockedPlan,
            preparedEpisodeId,
          );
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (!this.isRetryablePreparedEpisodeProseError(error) || attempt >= PREPARED_EPISODE_PROSE_MAX_ATTEMPTS) {
            break;
          }

          const delayMs = PREPARED_EPISODE_PROSE_RETRY_DELAYS_MS[attempt - 1] || 5000;
          this.logPipelineStep('prepared_episode_prose_retry', {
            seasonId: job.seasonId,
            jobId: job.jobId,
            preparedEpisodeId,
            choiceId: prepared.choiceId,
            nextEpisodeNumber: prepared.nextEpisodeNumber,
            attempt: attempt + 1,
            maxAttempts: PREPARED_EPISODE_PROSE_MAX_ATTEMPTS,
            delayMs,
            error: this.formatGenerationError(error),
          });
          this.logger.warn(
            `[PreparedEpisode] prose retry jobId=${job.jobId} preparedEpisodeId=${preparedEpisodeId} attempt=${attempt + 1}/${PREPARED_EPISODE_PROSE_MAX_ATTEMPTS} in ${delayMs}ms | ${this.formatGenerationError(error)}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      if (!episodeContent) {
        throw lastError || new Error('Prepared episode prose generation failed');
      }

      return await this.finalizePreparedEpisodeContent(job, prepared, season, hero, payload, episodeContent, dryRun);
    } catch (error) {
      return await this.failPreparedEpisodeJob(job, error);
    }
  }

  private async processPreparedEpisodeJob(job: GenerationJob, dryRun: boolean) {
    const claimed = await this.claimPendingJob(job);
    if (!claimed) {
      return {
        jobId: job.jobId,
        status: 'skipped',
      };
    }

    try {
      const payload = job.payload || {};
      const preparedEpisodeId = String(payload.preparedEpisodeId || '');
      const cancelled = await this.abortJobIfPreparedCancelled(job, preparedEpisodeId);
      if (cancelled) {
        return cancelled;
      }
      const prepared = await this.preparedEpisodesRepository.findOne({ where: { preparedEpisodeId } });
      const season = await this.seasonsRepository.findOne({ where: { seasonId: job.seasonId } });
      const hero = await this.heroesRepository.findOne({ where: { seasonId: job.seasonId } });

      if (!prepared || !season) {
        throw new Error('Prepared episode dependencies were not found');
      }
      if (prepared.status === 'cancelled') {
        return (await this.abortJobIfPreparedCancelled(job, preparedEpisodeId)) || {
          jobId: job.jobId,
          status: 'cancelled',
        };
      }

      if (dryRun) {
        throw new Error('Dry-run prepared episode generation is disabled: episode text must come from the model or fail explicitly.');
      }

      const episodeContent = await this.generateEpisodeContent(
            season,
            payload.framework || {},
            payload.seasonBible || {},
            hero,
            payload.outlineItem || {},
            payload.hypotheticalStoryState || {},
            payload.previousEpisodeSummary || null,
            payload.selectedChoice || null,
            null,
            preparedEpisodeId,
          );

      return await this.finalizePreparedEpisodeContent(job, prepared, season, hero, payload, episodeContent, dryRun);
    } catch (error) {
      return await this.failPreparedEpisodeJob(job, error);
    }
  }

  private async finalizePreparedEpisodeContent(
    job: GenerationJob,
    prepared: PreparedEpisode,
    season: Season,
    hero: Hero | null,
    payload: Record<string, any>,
    episodeContent: Record<string, any>,
    dryRun: boolean,
  ) {
    const preparedEpisodeId = prepared.preparedEpisodeId;
    const canonicalEpisodeContent = await this.canonicalizeEpisodeContentSceneCharacters(
      job.seasonId,
      episodeContent,
    );
    const uniqueEpisodeContent = await this.ensureUniqueSpeakingPrompt(
      job.seasonId,
      canonicalEpisodeContent,
      preparedEpisodeId,
    );
    const preparedAudioChunks: Record<string, any>[] = this.prepareAudioChunks(
      preparedEpisodeId,
      uniqueEpisodeContent,
      (prepared?.payload?.preparedAudioChunks as Record<string, any>[]) || [],
    ).map((chunk) => ({
      chunkId: chunk.chunkId,
      type: chunk.type,
      choiceId: chunk.choiceId ?? null,
      partIndex: chunk.partIndex ?? null,
      text: chunk.text,
      status: chunk.status,
      audioUrl: chunk.audioUrl ?? null,
      episodeId: null,
    }));
    const existingPreparedTtsJobs = await this.generationJobsRepository.find({
      where: [
        {
          seasonId: job.seasonId,
          jobType: 'prepared_tts_chunk',
          status: 'pending',
        },
      ],
    });
    const existingPreparedChunkIds = new Set(
      existingPreparedTtsJobs
        .map((item) => String(item.payload?.metadata?.preparedEpisodeId || '') === preparedEpisodeId ? String(item.payload?.metadata?.chunkId || '') : '')
        .filter(Boolean),
    );

    prepared.status = this.resolvePreparedEpisodeStatus(prepared.status, preparedAudioChunks);
    prepared.payload = {
      ...(prepared.payload || {}),
      episodeContent: uniqueEpisodeContent,
      preparedAudioChunks,
      preparedAt: new Date().toISOString(),
    };
    prepared.updatedAt = new Date();
    await this.preparedEpisodesRepository.save(prepared);
    await this.syncSeasonCharactersFromEpisode(
      job.seasonId,
      payload.seasonBible || {},
      hero,
      uniqueEpisodeContent,
    );
    await this.enqueuePreparedTtsJobs(
      job.seasonId,
      preparedEpisodeId,
      preparedAudioChunks.filter((chunk) => !existingPreparedChunkIds.has(chunk.chunkId)),
      new Date(),
      season.childProfile?.languageLevel,
    );
    await this.enqueuePreparedImageJob(
      job.seasonId,
      preparedEpisodeId,
      uniqueEpisodeContent,
      prepared.nextEpisodeNumber,
      hero,
      season.ownerUserId,
      new Date(),
    );
    this.logPipelineStep('prepared_episode_finalized', {
      seasonId: job.seasonId,
      preparedEpisodeId,
      nextEpisodeNumber: prepared.nextEpisodeNumber,
      choiceId: prepared.choiceId,
      ttsChunkCount: preparedAudioChunks.length,
      illustrationCandidate: Boolean(uniqueEpisodeContent?.illustrationCandidate?.shouldGenerate),
      dryRun,
    });

    job.status = 'ready_text_audio_pending';
    job.result = {
      preparedEpisodeId,
      nextEpisodeNumber: prepared.nextEpisodeNumber,
      dryRun,
    };
    job.error = null;
    job.updatedAt = new Date();
    await this.generationJobsRepository.save(job);

    return {
      jobId: job.jobId,
      status: job.status,
      preparedEpisodeId,
    };
  }

  private async failPreparedEpisodeJob(job: GenerationJob, error: unknown) {
    const preparedEpisodeId = String(job.payload?.preparedEpisodeId || '');
    if (preparedEpisodeId) {
      const prepared = await this.preparedEpisodesRepository.findOne({ where: { preparedEpisodeId } });
      if (prepared) {
        prepared.status = 'failed';
        prepared.updatedAt = new Date();
        await this.preparedEpisodesRepository.save(prepared);
      }
    }

    job.status = 'failed';
    job.error = this.formatGenerationError(error);
    job.updatedAt = new Date();
    await this.generationJobsRepository.save(job);

    return {
      jobId: job.jobId,
      status: job.status,
      error: job.error,
    };
  }

  private async processPreparedTtsJob(job: GenerationJob, dryRun: boolean) {
    const claimed = await this.claimPendingJob(job);
    if (!claimed) {
      return {
        jobId: job.jobId,
        status: 'skipped',
      };
    }

    try {
      const payload = job.payload || {};
      const metadata = payload.metadata || {};
      const preparedEpisodeId = String(metadata.preparedEpisodeId || '');
      const cancelled = await this.abortJobIfPreparedCancelled(job, preparedEpisodeId);
      if (cancelled) {
        return cancelled;
      }
      const prepared = await this.preparedEpisodesRepository.findOne({ where: { preparedEpisodeId } });

      if (!prepared) {
        throw new Error('Prepared episode for TTS job was not found');
      }
      if (prepared.status === 'cancelled') {
        return (await this.abortJobIfPreparedCancelled(job, preparedEpisodeId)) || {
          jobId: job.jobId,
          status: 'cancelled',
        };
      }

      const voice = payload.voice || undefined;
      const speed = typeof payload.speed === 'number' ? payload.speed : undefined;
      const audio = dryRun
        ? { audioUrl: this.buildDryRunAudioUrl(metadata.chunkId || job.jobId), durationSeconds: 0 }
        : await this.generateTtsAndUpload(
            payload.text || '',
            `audio/seasons/${job.seasonId}/prepared/${preparedEpisodeId}/${metadata.chunkId || job.jobId}.mp3`,
            voice,
            speed,
          );
      await this.persistPreparedTtsResult(job, preparedEpisodeId, metadata, audio.audioUrl, audio.durationSeconds, dryRun);

      return {
        jobId: job.jobId,
        status: dryRun ? 'ready_dry_run' : 'ready',
        audioUrl: audio.audioUrl,
      };
    } catch (error) {
      job.status = 'failed';
      job.error = this.formatGenerationError(error);
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);

      return {
        jobId: job.jobId,
        status: job.status,
        error: job.error,
      };
    }
  }

  async getSeasonCharacters(seasonId: string) {
    return this.seasonCharactersService.listBySeason(seasonId);
  }

  async upsertSeasonCharacter(seasonId: string, body: Partial<SeasonCharacter>) {
    return this.seasonCharactersService.upsertCharacter(seasonId, {
      ...body,
      displayName: body.displayName || 'Character',
      role: body.role || 'minor_character',
      type: body.type || 'story character',
      visualDescription: body.visualDescription || '',
    });
  }

  async backfillSeasonCharacters(seasonId: string) {
    const hero = await this.heroesRepository.findOne({ where: { seasonId } });
    const seasonFramework = await this.seasonFrameworksRepository.findOne({ where: { seasonId } });
    if (!seasonFramework) {
      throw new Error('Season framework not found');
    }
    return this.seasonCharactersService.syncFromSeasonBible(
      seasonId,
      seasonFramework.seasonBible || {},
      hero,
    );
  }

  private async syncSeasonCharactersFromEpisode(
    seasonId: string,
    seasonBible: Record<string, any>,
    hero: Hero | null,
    episodeContent: Record<string, any>,
  ) {
    await this.seasonCharactersService.syncFromSeasonBible(seasonId, seasonBible, hero);
    await this.seasonCharactersService.syncFromEpisodeContent(seasonId, episodeContent, hero);
  }

  private async canonicalizeEpisodeContentSceneCharacters(
    seasonId: string,
    episodeContent: Record<string, any>,
  ): Promise<Record<string, any>> {
    const canonicalSceneCharacters = await this.seasonCharactersService.canonicalizeSceneCharacters(
      seasonId,
      Array.isArray(episodeContent?.sceneCharacters) ? episodeContent.sceneCharacters : [],
    );
    const candidateSceneCharactersSource = Array.isArray(episodeContent?.illustrationCandidate?.sceneCharacters)
      ? episodeContent.illustrationCandidate.sceneCharacters
      : canonicalSceneCharacters;
    const canonicalCandidateSceneCharacters = await this.seasonCharactersService.canonicalizeSceneCharacters(
      seasonId,
      candidateSceneCharactersSource,
    );

    return {
      ...(episodeContent || {}),
      sceneCharacters: canonicalSceneCharacters,
      illustrationCandidate: {
        ...(episodeContent?.illustrationCandidate || {}),
        sceneCharacters: canonicalCandidateSceneCharacters,
      },
    };
  }

  private buildEpisodeContentFromEpisode(episode: Episode): Record<string, any> {
    const candidate = episode.illustrationCandidate || {};
    return {
      sceneCharacters: candidate.sceneCharacters || [],
      chapterText: episode.chapterText,
      title: episode.title,
      illustrationCandidate: candidate,
    };
  }

  private async attachPreparedIllustration(
    seasonId: string,
    episode: Episode,
    hero: Hero | null,
    preparedEpisode: PreparedEpisode | null,
  ) {
    const preparedIllustration = preparedEpisode?.payload?.preparedIllustration;
    if (!preparedIllustration?.imageUrl) {
      return null;
    }
    if (!['ready', 'ready_dry_run'].includes(String(preparedIllustration.status || ''))) {
      return null;
    }

    const existingEntry = await this.storybookEntriesRepository.findOne({
      where: { seasonId, episodeId: episode.episodeId, entryType: 'episode_illustration' },
    });
    const now = new Date();
    const illustrationId = String(preparedIllustration.illustrationId || uuidv4());
    const candidate = episode.illustrationCandidate || {};
    const illustrationStatus = preparedIllustration.status === 'ready_dry_run' ? 'ready_dry_run' : 'ready';
    const promptPayload = preparedIllustration.promptPayload || {
      moment: candidate.moment,
      episodeNumber: episode.episodeNumber,
      episodeTitle: episode.title,
      chapterText: episode.chapterText,
      sceneCharacters: candidate.sceneCharacters || [],
    };

    if (existingEntry) {
      const existingIllustration = existingEntry.illustrationId
        ? await this.illustrationsRepository.findOne({ where: { illustrationId: existingEntry.illustrationId } })
        : null;

      if (existingIllustration) {
        existingIllustration.status = illustrationStatus;
        existingIllustration.imageUrl = preparedIllustration.imageUrl;
        existingIllustration.promptPayload = promptPayload;
        existingIllustration.updatedAt = now;
        await this.illustrationsRepository.save(existingIllustration);
      } else {
        await this.illustrationsRepository.save(
          this.illustrationsRepository.create({
            illustrationId,
            seasonId,
            episodeId: episode.episodeId,
            entryType: 'episode_illustration',
            title: episode.title,
            status: illustrationStatus,
            imageUrl: preparedIllustration.imageUrl,
            promptPayload,
            createdAt: now,
            updatedAt: now,
          }),
        );
        existingEntry.illustrationId = illustrationId;
      }

      existingEntry.summary = candidate.moment || promptPayload.moment || existingEntry.summary;
      if (existingEntry.status !== 'locked') {
        existingEntry.status = 'ready';
      }
      existingEntry.updatedAt = now;
      await this.storybookEntriesRepository.save(existingEntry);

      this.logPipelineStep('prepared_illustration_attached', {
        seasonId,
        episodeId: episode.episodeId,
        episodeNumber: episode.episodeNumber,
        preparedEpisodeId: preparedEpisode?.preparedEpisodeId || null,
        illustrationId,
        heroReferenceReady: Boolean(hero?.heroReferenceImageUrl),
      });

      return existingEntry.storybookEntryId;
    }

    const storybookEntryId = uuidv4();

    await this.illustrationsRepository.save(
      this.illustrationsRepository.create({
        illustrationId,
        seasonId,
        episodeId: episode.episodeId,
        entryType: 'episode_illustration',
        title: episode.title,
        status: illustrationStatus,
        imageUrl: preparedIllustration.imageUrl,
        promptPayload,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.storybookEntriesRepository.save(
      this.storybookEntriesRepository.create({
        storybookEntryId,
        seasonId,
        episodeId: episode.episodeId,
        illustrationId,
        entryType: 'episode_illustration',
        title: `Episode ${episode.episodeNumber}: ${episode.title}`,
        summary: candidate.moment || preparedIllustration.promptPayload?.moment || '',
        status: 'locked',
        unlockCost: ILLUSTRATION_UNLOCK_COST,
        metadata: {
          episodeNumber: episode.episodeNumber,
          currentChoiceCount: Array.isArray(episode.choices) ? episode.choices.length : 0,
          pregenerated: true,
          preparedEpisodeId: preparedEpisode?.preparedEpisodeId || null,
        },
        createdAt: now,
        updatedAt: now,
      }),
    );

    this.logPipelineStep('prepared_illustration_attached', {
      seasonId,
      episodeId: episode.episodeId,
      episodeNumber: episode.episodeNumber,
      preparedEpisodeId: preparedEpisode?.preparedEpisodeId || null,
      illustrationId,
      heroReferenceReady: Boolean(hero?.heroReferenceImageUrl),
    });

    return storybookEntryId;
  }

  private async isPreparedIllustrationInProgress(
    seasonId: string,
    preparedEpisode: PreparedEpisode,
  ): Promise<boolean> {
    const illustrationStatus = String(preparedEpisode.payload?.preparedIllustration?.status || '');
    if (['ready', 'ready_dry_run', 'failed'].includes(illustrationStatus)) {
      return false;
    }

    const pendingJob = await this.generationJobsRepository
      .createQueryBuilder('job')
      .where('job.seasonId = :seasonId', { seasonId })
      .andWhere("job.jobType = 'prepared_image_generation'")
      .andWhere("job.status IN ('pending', 'processing')")
      .andWhere("job.payload->>'preparedEpisodeId' = :preparedEpisodeId", {
        preparedEpisodeId: preparedEpisode.preparedEpisodeId,
      })
      .getOne();

    if (!pendingJob) {
      return false;
    }

    if (this.isStaleProcessingJob(pendingJob)) {
      await this.requeueProcessingJob(pendingJob, 'prepared illustration stale recovery');
      return true;
    }

    return true;
  }

  private async findPreparedEpisodeForCurrentEpisode(
    seasonId: string,
    episode: Episode,
  ): Promise<PreparedEpisode | null> {
    const preparedByUsedEpisode = await this.preparedEpisodesRepository
      .createQueryBuilder('prepared')
      .where('prepared.seasonId = :seasonId', { seasonId })
      .andWhere("prepared.payload->>'usedEpisodeId' = :episodeId", { episodeId: episode.episodeId })
      .orderBy('prepared.updatedAt', 'DESC')
      .getOne();

    if (preparedByUsedEpisode) {
      return preparedByUsedEpisode;
    }

    return this.preparedEpisodesRepository
      .createQueryBuilder('prepared')
      .where('prepared.seasonId = :seasonId', { seasonId })
      .andWhere('prepared.nextEpisodeNumber = :episodeNumber', { episodeNumber: episode.episodeNumber })
      .andWhere("prepared.status IN ('used', 'ready', 'ready_dry_run', 'ready_text_audio_pending', 'ready_text_audio_partial')")
      .orderBy('prepared.updatedAt', 'DESC')
      .getOne();
  }

  private async isIllustrationJobInProgress(
    seasonId: string,
    episodeId: string,
  ): Promise<boolean> {
    const pendingJob = await this.generationJobsRepository
      .createQueryBuilder('job')
      .where('job.seasonId = :seasonId', { seasonId })
      .andWhere('job.episodeId = :episodeId', { episodeId })
      .andWhere("job.jobType = 'image_generation'")
      .andWhere("job.status IN ('pending', 'processing')")
      .getOne();

    return Boolean(pendingJob);
  }

  private async shouldFallbackPreparedIllustration(
    seasonId: string,
    preparedEpisode: PreparedEpisode,
  ): Promise<boolean> {
    const illustrationStatus = String(preparedEpisode.payload?.preparedIllustration?.status || '');
    if (['ready', 'ready_dry_run'].includes(illustrationStatus)) {
      return false;
    }

    if (illustrationStatus === 'failed') {
      return true;
    }

    if (await this.isPreparedIllustrationInProgress(seasonId, preparedEpisode)) {
      return false;
    }

    return true;
  }

  private async resolveEpisodeIllustrationAfterChoice(
    seasonId: string,
    episode: Episode,
    hero: Hero | null,
    preparedEpisode: PreparedEpisode | null,
  ) {
    await this.attachPreparedIllustration(seasonId, episode, hero, preparedEpisode);

    const hasIllustrationEntry = await this.storybookEntriesRepository.findOne({
      where: { seasonId, episodeId: episode.episodeId, entryType: 'episode_illustration' },
    });
    if (hasIllustrationEntry) {
      return;
    }

    const prepared = preparedEpisode
      ? await this.preparedEpisodesRepository.findOne({
          where: { preparedEpisodeId: preparedEpisode.preparedEpisodeId },
        })
      : null;

    if (prepared && (await this.isPreparedIllustrationInProgress(seasonId, prepared))) {
      this.logPipelineStep('prepared_illustration_waiting', {
        seasonId,
        episodeId: episode.episodeId,
        episodeNumber: episode.episodeNumber,
        preparedEpisodeId: prepared.preparedEpisodeId,
        illustrationStatus: prepared.payload?.preparedIllustration?.status || null,
      });

      const attachedWhileWaiting = await this.waitForPreparedIllustration(
        seasonId,
        episode,
        hero,
        prepared,
      );
      if (attachedWhileWaiting) {
        return;
      }

      const stillHasIllustrationEntry = await this.storybookEntriesRepository.findOne({
        where: { seasonId, episodeId: episode.episodeId, entryType: 'episode_illustration' },
      });
      if (stillHasIllustrationEntry) {
        return;
      }

      const reloadedPrepared = await this.preparedEpisodesRepository.findOne({
        where: { preparedEpisodeId: prepared.preparedEpisodeId },
      });
      if (reloadedPrepared && (await this.isPreparedIllustrationInProgress(seasonId, reloadedPrepared))) {
        this.logPipelineStep('prepared_illustration_deferred', {
          seasonId,
          episodeId: episode.episodeId,
          episodeNumber: episode.episodeNumber,
          preparedEpisodeId: reloadedPrepared.preparedEpisodeId,
          illustrationStatus: reloadedPrepared.payload?.preparedIllustration?.status || null,
        });
        return;
      }
    }

    if (!prepared) {
      await this.prepareEpisodeIllustration(seasonId, episode, hero);
      return;
    }

    if (!(await this.shouldFallbackPreparedIllustration(seasonId, prepared))) {
      await this.attachPreparedIllustration(seasonId, episode, hero, prepared);
      return;
    }

    if (await this.isIllustrationJobInProgress(seasonId, episode.episodeId)) {
      return;
    }

    this.logPipelineStep('prepared_illustration_fallback', {
      seasonId,
      episodeId: episode.episodeId,
      episodeNumber: episode.episodeNumber,
      preparedEpisodeId: prepared.preparedEpisodeId,
      illustrationStatus: prepared.payload?.preparedIllustration?.status || null,
    });
    await this.prepareEpisodeIllustration(seasonId, episode, hero);
  }

  private async attachPreparedIllustrationToUsedEpisode(
    seasonId: string,
    prepared: PreparedEpisode,
    hero: Hero | null,
  ) {
    const usedEpisodeId = String(prepared.payload?.usedEpisodeId || '');
    if (!usedEpisodeId) {
      return null;
    }

    const episode = await this.episodesRepository.findOne({ where: { episodeId: usedEpisodeId, seasonId } });
    if (!episode) {
      return null;
    }

    return this.attachPreparedIllustration(seasonId, episode, hero, prepared);
  }

  private async prepareEpisodeIllustration(seasonId: string, episode: Episode, hero: Hero | null) {
    const candidate = episode.illustrationCandidate || {};
    if (!candidate.shouldGenerate || !candidate.moment) {
      return null;
    }
    if (!hero?.heroReferenceImageUrl) {
      return null;
    }

    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season) {
      return null;
    }

    const eligibility = await this.getIllustrationCrystalEligibility(season.ownerUserId, seasonId);
    if (!eligibility.hasEnoughCrystals) {
      this.logPipelineStep('illustration_waiting_for_crystals', {
        seasonId,
        episodeId: episode.episodeId,
        episodeNumber: episode.episodeNumber,
        balance: eligibility.balance,
        requiredCrystals: eligibility.requiredCrystals,
      });
      return null;
    }

    const existingEntry = await this.storybookEntriesRepository.findOne({
      where: { seasonId, episodeId: episode.episodeId, entryType: 'episode_illustration' },
    });
    if (existingEntry) {
      const pendingJob = await this.generationJobsRepository.findOne({
        where: {
          seasonId,
          episodeId: episode.episodeId,
          jobType: 'image_generation',
          status: 'pending',
        },
      });
      if (!pendingJob) {
        await this.enqueueIllustrationJob(
          seasonId,
          episode,
          existingEntry.illustrationId,
          existingEntry.storybookEntryId,
        );
      }
      return existingEntry;
    }

    const now = new Date();
    const illustrationId = uuidv4();
    const storybookEntryId = uuidv4();

    await this.illustrationsRepository.save(
      this.illustrationsRepository.create({
        illustrationId,
        seasonId,
        episodeId: episode.episodeId,
        entryType: 'episode_illustration',
        title: episode.title,
        status: 'queued',
        imageUrl: null,
        promptPayload: {
          moment: candidate.moment,
          episodeNumber: episode.episodeNumber,
          episodeTitle: episode.title,
          chapterText: episode.chapterText,
          sceneCharacters: candidate.sceneCharacters || [],
        },
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.storybookEntriesRepository.save(
      this.storybookEntriesRepository.create({
        storybookEntryId,
        seasonId,
        episodeId: episode.episodeId,
        illustrationId,
        entryType: 'episode_illustration',
        title: `Episode ${episode.episodeNumber}: ${episode.title}`,
        summary: candidate.moment,
        status: 'locked',
        unlockCost: ILLUSTRATION_UNLOCK_COST,
        metadata: {
          episodeNumber: episode.episodeNumber,
          currentChoiceCount: Array.isArray(episode.choices) ? episode.choices.length : 0,
          pregenerated: true,
        },
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.enqueueIllustrationJob(seasonId, episode, illustrationId, storybookEntryId);
    return storybookEntryId;
  }

  private async saveIllustrationTtiPrompt(
    illustrationId: string,
    promptPayload: Record<string, any>,
    ttiPrompt: Record<string, any>,
  ) {
    const illustration = await this.illustrationsRepository.findOne({ where: { illustrationId } });
    if (!illustration) {
      return;
    }

    illustration.promptPayload = {
      ...(illustration.promptPayload || {}),
      ...promptPayload,
      ttiPrompt,
    };
    illustration.updatedAt = new Date();
    await this.illustrationsRepository.save(illustration);
  }

  private async generateEpisodeIllustrationAndUpload(
    seasonId: string,
    episodeId: string | null | undefined,
    illustrationId: string | null,
    framework: Record<string, any>,
    seasonBible: Record<string, any>,
    hero: Hero,
    promptPayload: Record<string, any>,
    storageKey: string,
    options: {
      moderationRetryMode?: 'same_prompt_only' | 'same_prompt_then_safer';
      recoveryRequestId?: string | null;
    } = {},
  ) {
    const episode = episodeId
      ? await this.episodesRepository.findOne({ where: { episodeId } })
      : null;

    if (episode) {
      await this.syncSeasonCharactersFromEpisode(
        seasonId,
        seasonBible,
        hero,
        this.buildEpisodeContentFromEpisode(episode),
      );
    }

    const roster = await this.seasonCharactersService.listBySeason(seasonId);
    if (!roster.length) {
      await this.seasonCharactersService.ensureSeasonRoster(seasonId, hero, seasonBible);
    }
    const activeRoster = roster.length
      ? roster
      : await this.seasonCharactersService.listBySeason(seasonId);

    const moment = this.sanitizeImagePromptText(String(promptPayload.moment || episode?.illustrationCandidate?.moment || ''));
    const episodeTitle = this.sanitizeImagePromptText(
      String(promptPayload.episodeTitle || episode?.title || ''),
    );

    const visualManifest = this.ttiPromptService.buildEpisodeVisualManifest({
      seasonId,
      episodeId: episodeId || undefined,
      episodeTitle,
      moment,
      characters: activeRoster,
      sceneCharacters: episode?.illustrationCandidate?.sceneCharacters || promptPayload.sceneCharacters || [],
    });

    const heroReferenceImageUrl = this.isHttpUrl(hero.heroReferenceImageUrl)
      ? hero.heroReferenceImageUrl
      : undefined;

    const ttiInput = {
      episodeTitle,
      episodeNumber: Number(promptPayload.episodeNumber || episode?.episodeNumber || 0),
      moment,
      seasonStyleGuide: seasonBible.illustrationStyleGuide || seasonBible.illustrationStyle || {},
      heroReferenceImageUrl,
      visualManifest,
    };

    let compiled = this.ttiPromptService.compileTTIPrompt(ttiInput, {
      roster: activeRoster,
      safetyBoundaries: Array.isArray(framework.safetyBoundaries) ? framework.safetyBoundaries : [],
    });
    let validation = this.ttiPromptService.validateTTIPrompt(compiled, activeRoster, visualManifest);
    if (!validation.valid && validation.fixedPrompt) {
      compiled = validation.fixedPrompt;
      validation = this.ttiPromptService.validateTTIPrompt(compiled, activeRoster, visualManifest);
    }
    if (!validation.valid) {
      const errors = validation.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('; ');
      throw new Error(`TTI prompt validation failed: ${errors}`);
    }

    const prompt = this.ttiPromptService.buildFinalApiPrompt(compiled);
    const ttiPrompt = {
      promptVersion: 'tti-v1',
      positivePrompt: compiled.positivePrompt,
      negativePrompt: compiled.negativePrompt,
      finalPrompt: prompt,
      selectedCharacterIds: visualManifest.selectedCharacterIds,
      selectedCharacters: compiled.selectedCharacters,
      props: compiled.props,
      environment: compiled.environment,
      visualManifest,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
      },
      compiledAt: new Date().toISOString(),
    };

    if (illustrationId) {
      await this.saveIllustrationTtiPrompt(
        illustrationId,
        {
          moment,
          episodeNumber: promptPayload.episodeNumber,
          episodeTitle,
          chapterText: promptPayload.chapterText,
          sceneCharacters: episode?.illustrationCandidate?.sceneCharacters || promptPayload.sceneCharacters || [],
        },
        ttiPrompt,
      );
    }

    console.log('[ImagePrompt] TTI manifest:', {
      seasonId,
      episodeNumber: promptPayload.episodeNumber,
      illustrationId,
      selectedCharacterIds: visualManifest.selectedCharacterIds,
      props: visualManifest.props.map((item) => item.name),
      positivePromptLength: compiled.positivePrompt.length,
      finalPromptLength: prompt.length,
    });

    const moderationRetryMode = options.moderationRetryMode || 'same_prompt_then_safer';
    const primaryModerationAttempts =
      moderationRetryMode === 'same_prompt_only'
        ? PREPARED_ILLUSTRATION_MODERATION_MAX_ATTEMPTS
        : 3;

    try {
      const generation = await this.generateIllustrationWithModerationRetries(
        prompt,
        storageKey,
        'primary',
        primaryModerationAttempts,
        { preparedPregeneration: moderationRetryMode === 'same_prompt_only' },
        options.recoveryRequestId || null,
      );
      return { imageUrl: generation.imageUrl, ttiPrompt, requestId: generation.requestId || null };
    } catch (error) {
      if (moderationRetryMode === 'same_prompt_only' || !this.isProtectedContentModerationError(error)) {
        throw error;
      }

      const saferCompiled = this.ttiPromptService.compileTTIPrompt(
        {
          ...ttiInput,
          moment: this.sanitizeImagePromptText(moment).slice(0, 220),
        },
        {
          roster: activeRoster,
          safetyBoundaries: Array.isArray(framework.safetyBoundaries) ? framework.safetyBoundaries : [],
        },
      );
      const saferPrompt = this.ttiPromptService.buildFinalApiPrompt(saferCompiled);
      const saferTtiPrompt = {
        ...ttiPrompt,
        positivePrompt: saferCompiled.positivePrompt,
        negativePrompt: saferCompiled.negativePrompt,
        finalPrompt: saferPrompt,
        moderationFallback: true,
      };
      if (illustrationId) {
        await this.saveIllustrationTtiPrompt(illustrationId, promptPayload, saferTtiPrompt);
      }
      const generation = await this.generateIllustrationWithModerationRetries(
        saferPrompt,
        storageKey,
        'fallback',
        2,
      );
      return { imageUrl: generation.imageUrl, ttiPrompt: saferTtiPrompt, requestId: generation.requestId || null };
    }
  }

  private isHttpUrl(value: string | null | undefined): boolean {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  private async uploadToStorage(key: string, body: Buffer, contentType: string): Promise<string> {
    return this.storage.upload(key, body, contentType);
  }

  private async generateAndStoreIllustration(
    prompt: string,
    storageKey: string,
    options: { recoveryRequestId?: string | null; allowRetryAfterRecoveryMiss?: boolean } = {},
  ): Promise<{ imageUrl: string; requestId: string | null }> {
    const recoveryRequestId = options.recoveryRequestId || null;
    if (recoveryRequestId) {
      const recovered = await this.pixazo.recoverImage(recoveryRequestId);
      if (recovered.status === 'completed' && recovered.url) {
        this.logger.log(
          `[Illustration] Pixazo recovery succeeded for ${storageKey} via request ${recoveryRequestId}`,
        );
        const downloaded = await this.downloadGeneratedImageWithRetry(recovered.url, storageKey);
        const imageUrl = await this.uploadGeneratedImageWithRetry(
          downloaded.body,
          downloaded.contentType,
          storageKey,
          recovered.url,
        );
        return { imageUrl, requestId: recoveryRequestId };
      }

      this.logger.warn(
        `[Illustration] Pixazo recovery miss for ${storageKey} via request ${recoveryRequestId} status=${recovered.status}; starting a fresh generation`,
      );
    }

    const result = await this.generatePixazoImageWithTimeoutRecovery(prompt, storageKey);
    if (!result?.url) {
      throw new Error('Pixazo image generation returned an empty response');
    }

    const sourceUrl = result.url;
    this.logger.log(`[Illustration] Pixazo image ready for ${storageKey}`);

    const downloaded = await this.downloadGeneratedImageWithRetry(sourceUrl, storageKey);
    const imageUrl = await this.uploadGeneratedImageWithRetry(downloaded.body, downloaded.contentType, storageKey, sourceUrl);
    return { imageUrl, requestId: result.requestId || null };
  }

  private async generateIllustrationWithModerationRetries(
    prompt: string,
    storageKey: string,
    promptStage: 'primary' | 'fallback',
    maxAttempts = 3,
    options: { preparedPregeneration?: boolean } = {},
    recoveryRequestId?: string | null,
  ) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.generateAndStoreIllustration(prompt, storageKey, {
          recoveryRequestId: attempt === 1 ? recoveryRequestId || null : null,
        });
      } catch (error) {
        const isModeration = this.isProtectedContentModerationError(error);
        if (!isModeration || attempt >= maxAttempts) {
          throw error;
        }

        const delayMs = attempt * 2000;
        const logMessage = options.preparedPregeneration
          ? 'prepared_illustration_moderation_retry'
          : 'illustration_moderation_retry';
        this.logPipelineStep(logMessage, {
          storageKey,
          promptStage,
          attempt: attempt + 1,
          maxAttempts,
          delayMs,
          error: this.formatGenerationError(error),
        });
        this.logger.warn(
          `[Illustration] Pixazo moderation retry for ${storageKey} stage=${promptStage} attempt=${attempt + 1}/${maxAttempts} in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Failed to generate illustration after moderation retries');
  }

  private async generatePixazoImageWithTimeoutRecovery(prompt: string, storageKey: string) {
    try {
      return await this.pixazo.generateImage(prompt);
    } catch (error) {
      const requestId = this.extractPixazoRequestId(error);
      if (!requestId || !this.isPixazoPollTimeoutError(error)) {
        throw error;
      }

      this.logger.warn(
        `[Illustration] Pixazo poll timeout for ${storageKey}; attempting recovery via request ${requestId}`,
      );
      const recovered = await this.pixazo.recoverImage(requestId);
      if (recovered.status === 'completed' && recovered.url) {
        this.logger.log(
          `[Illustration] Pixazo recovery succeeded after timeout for ${storageKey} via request ${requestId}`,
        );
        return { url: recovered.url, requestId };
      }

      this.logger.warn(
        `[Illustration] Pixazo recovery after timeout returned ${recovered.status} for ${storageKey}; starting a fresh generation with the same prompt`,
      );
      return await this.pixazo.generateImage(prompt);
    }
  }

  private async downloadGeneratedImageWithRetry(
    sourceUrl: string,
    storageKey: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    for (let attempt = 1; attempt <= ILLUSTRATION_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await axios.get(sourceUrl, {
          responseType: 'arraybuffer',
          timeout: ILLUSTRATION_DOWNLOAD_TIMEOUT_MS,
          validateStatus: (status) => status >= 200 && status < 300,
        });
        const contentType = String(response.headers?.['content-type'] || 'image/png');
        const body = Buffer.from(response.data);
        if (!body.length) {
          throw new Error('Downloaded image is empty');
        }

        this.logger.log(
          `[Illustration] Downloaded ${body.length} bytes from Pixazo CDN for ${storageKey} (attempt ${attempt}/${ILLUSTRATION_DOWNLOAD_MAX_ATTEMPTS})`,
        );
        return { body, contentType };
      } catch (error) {
        this.logger.logIllustrationStorageError(
          'pixazo_download',
          storageKey,
          sourceUrl,
          error,
          attempt,
          ILLUSTRATION_DOWNLOAD_MAX_ATTEMPTS,
        );

        if (attempt >= ILLUSTRATION_DOWNLOAD_MAX_ATTEMPTS) {
          throw new Error(
            `Failed to download generated illustration after ${ILLUSTRATION_DOWNLOAD_MAX_ATTEMPTS} attempts`,
          );
        }

        const delayMs = ILLUSTRATION_DOWNLOAD_RETRY_DELAYS_MS[attempt - 1] ?? 15000;
        this.logger.warn(`[Illustration] Retrying Pixazo download in ${delayMs}ms for ${storageKey}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Failed to download generated illustration');
  }

  private async uploadGeneratedImageWithRetry(
    body: Buffer,
    contentType: string,
    storageKey: string,
    sourceUrl: string,
  ): Promise<string> {
    for (let attempt = 1; attempt <= ILLUSTRATION_UPLOAD_MAX_ATTEMPTS; attempt++) {
      try {
        const storedUrl = await this.storage.upload(storageKey, body, contentType);
        this.logger.log(`[Illustration] Stored image for ${storageKey} (attempt ${attempt}/${ILLUSTRATION_UPLOAD_MAX_ATTEMPTS})`);
        return storedUrl;
      } catch (error) {
        this.logger.logIllustrationStorageError(
          'r2_upload',
          storageKey,
          sourceUrl,
          error,
          attempt,
          ILLUSTRATION_UPLOAD_MAX_ATTEMPTS,
        );

        if (attempt >= ILLUSTRATION_UPLOAD_MAX_ATTEMPTS) {
          throw new Error('Failed to store generated illustration in storage');
        }

        this.logger.warn(`[Illustration] Retrying R2 upload for ${storageKey}`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    throw new Error('Failed to store generated illustration in storage');
  }

  private buildImageSafeFramework(framework: Record<string, any>) {
    return this.sanitizeImagePromptValue({
      seasonPremise: framework.seasonPremise || '',
      centralProblem: framework.centralProblem || '',
      dramaticQuestion: framework.dramaticQuestion || '',
      toneGuide: framework.toneGuide || '',
      recurringMotifs: framework.recurringMotifs || [],
      worldRules: framework.worldRules || framework.rulesOfWorld || [],
    });
  }

  private buildImageSafeHeroProfile(heroProfile: Record<string, any>) {
    return this.sanitizeImagePromptValue({
      name: heroProfile?.name || heroProfile?.preferredName || '',
      heroType: heroProfile?.heroType || '',
      traits: heroProfile?.traits || [],
      companion: heroProfile?.companion || '',
      favoriteColor: heroProfile?.favoriteColor || '',
      accessory: heroProfile?.accessory || '',
      signatureItem: heroProfile?.signatureItem || '',
    });
  }

  private buildProtectedContentFallbackPrompt(
    heroProfile: Record<string, any>,
    heroVisualBrief: Record<string, any>,
    heroReferenceImageUrl: string | null,
    sceneBrief: Record<string, any>,
    imagePromptPayload: Record<string, any>,
  ) {
    const fallbackHero = this.stringifyPromptData(this.buildImageSafeHeroProfile(heroProfile), 600);
    const fallbackVisual = this.stringifyPromptData(this.sanitizeImagePromptValue(heroVisualBrief || {}), 700);
    const fallbackReference = this.buildHeroReferenceHint(heroReferenceImageUrl);
    const fallbackSceneBrief = this.stringifyPromptData(sceneBrief, 1000);
    const fallbackScene = this.stringifyPromptData({
      moment: imagePromptPayload.moment,
      visualGoal: 'Focus on one original fantasy story beat with clear emotion and readable action.',
    }, 900);

    return `Create an original children's fantasy illustration of one specific story beat.

Hero anchor:
${fallbackHero}

Visual brief:
${fallbackVisual}

Hero reference image anchor:
${fallbackReference}

Scene brief:
${fallbackSceneBrief}

Scene beat:
${fallbackScene}

Requirements:
- fully original world and character presentation
- preserve the same hero identity, outfit, silhouette, palette, companion, and accessory from the hero reference
- treat the scene brief as mandatory composition guidance
- include every required character from the scene brief exactly once
- show one clear action beat, not a poster, montage, or cover
- render symbol walls, runes, maps, carvings, or writing-like elements only as abstract pictograms, never readable text
- no franchise names, no branded dragons, no studio-specific designs, no copyrighted characters
- warm, expressive, child-safe storybook illustration
- one clear scene, readable pose, clean composition
- no text, no top title, no map display, no extra random children, no crowd
- no text, no watermark, no UI`;
  }

  private buildIllustrationSceneBrief(
    promptPayload: Record<string, any>,
    heroProfile: Record<string, any>,
    framework: Record<string, any>,
  ) {
    const moment = this.sanitizeImagePromptText(String(promptPayload?.moment || ''));
    const chapterText = this.sanitizeImagePromptText(String(promptPayload?.chapterText || ''));
    const episodeTitle = this.sanitizeImagePromptText(String(promptPayload?.episodeTitle || ''));
    const mergedText = [episodeTitle, moment, chapterText].filter(Boolean).join('\n');
    const heroName = String(heroProfile?.name || heroProfile?.preferredName || 'Hero').trim();
    const companionName = String(heroProfile?.companion?.name || '').trim();
    const symbolicScene = this.isSymbolicIllustrationScene(mergedText);
    const characters = this.extractSceneCharacters(mergedText, heroName, companionName);

    return this.sanitizeImagePromptValue({
      episodeTitle,
      sceneType: this.detectIllustrationSceneType(mergedText, symbolicScene),
      primaryVisualChange: this.buildPrimaryVisualChange(moment, chapterText, symbolicScene),
      focalPoint: symbolicScene
        ? 'Character group interacting with a glowing symbolic clue surface.'
        : 'The exact chapter beat where the environment or action visibly changes.',
      requiredCharacters: characters.required,
      optionalCharacters: characters.optional,
      requiredObjects: this.extractRequiredObjects(mergedText, symbolicScene),
      compositionRules: this.buildCompositionRules(symbolicScene, mergedText),
      forbiddenFailures: this.buildIllustrationForbiddenFailures(symbolicScene),
      symbolRenderingMode: symbolicScene
        ? 'Use only abstract pictograms, icon shapes, spirals, and non-readable marks.'
        : 'Do not introduce text-like marks unless unavoidable, and if so keep them non-readable.',
      mood: this.deriveIllustrationMood(mergedText, framework),
    });
  }

  private extractSceneCharacters(text: string, heroName: string, companionName: string) {
    const required: string[] = [];
    const optional: string[] = [];
    const normalizedText = text.toLowerCase();

    if (heroName) {
      required.push(`${heroName} - recurring child hero, must stay visually consistent with the hero reference`);
    }

    if (companionName && normalizedText.includes(companionName.toLowerCase())) {
      required.push(`${companionName} - recurring companion, include as a separate visible character if mentioned`);
    } else if (companionName) {
      optional.push(`${companionName} - include only if the chapter beat explicitly places this companion in the scene`);
    }

    for (const name of this.extractCapitalizedNameCandidates(text)) {
      if (name === heroName || name === companionName) {
        continue;
      }
      required.push(`${name} - named scene participant, include once if explicitly present in this chapter beat`);
    }

    return {
      required: this.uniqueStrings(required),
      optional: this.uniqueStrings(optional),
    };
  }

  private extractCapitalizedNameCandidates(text: string) {
    const matches = Array.from(text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g))
      .map((match) => match[1].trim());

    return this.uniqueStrings(
      matches.filter((name) => {
        const lowered = name.toLowerCase();
        if (['the', 'a', 'an', 'this', 'that', 'these', 'those', 'episode', 'storyhop'].includes(lowered)) {
          return false;
        }
        return name.length >= 3;
      }),
    );
  }

  private extractRequiredObjects(text: string, symbolicScene: boolean) {
    const objects: string[] = [];
    const lowered = text.toLowerCase();
    const objectRules: Array<[string, string]> = [
      ['lantern', 'Lantern or warm handheld light source'],
      ['stone', 'Important magical stone or crystal tied to the action beat'],
      ['statue', 'Statue or carved figure involved in the scene change'],
      ['tunnel', 'Visible tunnel, doorway, or newly opened path if the beat reveals one'],
      ['map', 'Map-like clue rendered only as visual symbolism'],
      ['symbol', 'Glowing symbol surface or clue wall'],
      ['carving', 'Ancient carved surface or clue-bearing wall'],
      ['mist', 'Mist or magical barrier reacting to the scene'],
      ['bowl', 'Bowl, socket, or receiving object for the magical item'],
    ];

    for (const [needle, label] of objectRules) {
      if (lowered.includes(needle)) {
        objects.push(label);
      }
    }

    if (symbolicScene && !objects.some((item) => item.includes('symbol'))) {
      objects.push('Glowing symbol surface or clue wall');
    }

    return this.uniqueStrings(objects);
  }

  private buildCompositionRules(symbolicScene: boolean, text: string) {
    const rules = [
      'Single coherent in-story moment, not a poster, cover, infographic, or collage.',
      'Keep the main action beat readable at a glance.',
      'Widen the camera if needed so every required character remains visible in one frame.',
      'Do not duplicate characters or replace multiple companions with one generic figure.',
    ];

    if (/(together|both|group|with)/i.test(text)) {
      rules.push('If the chapter beat is shared, keep the whole group present in the same frame.');
    }

    if (symbolicScene) {
      rules.push('The clue surface should be a focal point, but must not turn into readable writing.');
      rules.push('Prefer abstract pictograms and icon-like shapes over dense inscriptions.');
    }

    return rules;
  }

  private buildIllustrationForbiddenFailures(symbolicScene: boolean) {
    const failures = [
      'Readable text, title banners, labels, captions, or fake alphabet.',
      'Poster composition instead of a chapter moment.',
      'Random extra children, helpers, creatures, or crowding not required by the scene.',
      'Missing required named character or merging multiple companions into one.',
      'Franchise-specific or branded character likenesses.',
    ];

    if (symbolicScene) {
      failures.push('Carvings, symbols, maps, or runes rendered as readable words instead of pictograms.');
    }

    return failures;
  }

  private detectIllustrationSceneType(text: string, symbolicScene: boolean) {
    const lowered = text.toLowerCase();
    if (symbolicScene) return 'discovery_clue_reveal';
    if (/(runs?|rush|chase|faster|escape|fight|flies?|storm)/.test(lowered)) return 'action_transition';
    if (/(opens?|glows?|awakens?|reveals?|appears?)/.test(lowered)) return 'magical_reveal';
    if (/(says|asks|whispers|smiles|looks at)/.test(lowered)) return 'dialogue_connection';
    return 'story_beat';
  }

  private isSymbolicIllustrationScene(text: string) {
    return /(symbol|rune|carving|map|words on the wall|spiral|glowing wall|ancient marks|clue wall)/i.test(text);
  }

  private buildPrimaryVisualChange(moment: string, chapterText: string, symbolicScene: boolean) {
    if (moment) {
      return moment;
    }

    return this.truncateText(chapterText, symbolicScene ? 240 : 200);
  }

  private deriveIllustrationMood(text: string, framework: Record<string, any>) {
    const lowered = text.toLowerCase();
    const moods: string[] = [];
    if (/(warm|hope|glow|smile|together|trust)/.test(lowered)) moods.push('warmth');
    if (/(clue|discover|look|map|symbol|carving)/.test(lowered)) moods.push('discovery');
    if (/(courage|brave|forward|decide)/.test(lowered)) moods.push('courage');
    if (/(mist|danger|dark|whisper)/.test(lowered)) moods.push('tension');
    if (framework?.toneGuide) moods.push(String(framework.toneGuide));
    return this.uniqueStrings(moods.length ? moods : ['wonder', 'story focus']);
  }

  private uniqueStrings(values: string[]) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  private stringifyPromptData(value: unknown, maxChars: number) {
    const raw = JSON.stringify(value || {}, null, 2);
    if (raw.length <= maxChars) {
      return raw;
    }

    const kept = Math.max(0, maxChars - 40);
    return `${raw.slice(0, kept)}\n... [truncated]`;
  }

  private truncateText(text: string, maxChars: number) {
    if (text.length <= maxChars) {
      return text;
    }

    return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
  }

  private buildHeroReferenceHint(heroReferenceImageUrl: string | null | undefined) {
    const value = String(heroReferenceImageUrl || '').trim();
    if (!value) {
      return 'No hero reference image URL available.';
    }

    if (value.startsWith('data:image/')) {
      return 'Hero reference image exists in storage as an inline data URL fallback. Preserve the established hero look, outfit, silhouette, and accessory from prior episodes.';
    }

    return this.truncateText(value, 500);
  }

  private sanitizeImagePromptValue(value: any): any {
    if (typeof value === 'string') {
      return this.sanitizeImagePromptText(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeImagePromptValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [key, this.sanitizeImagePromptValue(nestedValue)]),
      );
    }

    return value;
  }

  private sanitizeImagePromptText(text: string) {
    if (!text) {
      return '';
    }

    const replacements: Array<[RegExp, string]> = [
      [/"[^"\n]{2,120}"/g, ''],
      [/'[^'\n]{2,120}'/g, ''],
      [/how to train your dragon/gi, 'an original dragon-and-viking fantasy adventure'],
      [/toothless/gi, 'a swift black dragon'],
      [/hiccup/gi, 'a young inventor hero'],
      [/dreamworks/gi, ''],
      [/disney/gi, ''],
      [/pixar/gi, ''],
      [/marvel/gi, ''],
      [/harry potter/gi, 'a young magic student adventure'],
      [/hogwarts/gi, 'a hidden magic school'],
      [/star wars/gi, 'a space fantasy adventure'],
      [/pokemon/gi, 'friendly fantasy creatures'],
      [/из серии[^.,;\n]*/gi, ''],
      [/from the series[^.,;\n]*/gi, ''],
      [/in the style of[^.,;\n]*/gi, ''],
      [/\blike [A-ZА-Я][^.,;\n]*/g, ''],
    ];

    let cleaned = text;
    for (const [pattern, replacement] of replacements) {
      cleaned = cleaned.replace(pattern, replacement);
    }

    cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?:;])/g, '$1').trim();
    return cleaned;
  }

  private isProtectedContentModerationError(error: any) {
    const responseData = this.stringifyModerationContext(error?.response?.data);
    const errorMessage = this.stringifyModerationContext(error?.message);
    const causeMessage = this.stringifyModerationContext(error?.cause?.message || error?.cause);
    const combined = `${responseData}\n${errorMessage}\n${causeMessage}`;
    return /Protected Content|Request Moderated|copyright|moderation_blocked|image_generation_user_error|rejected by the safety system|content policy|safety system|moderation/i.test(
      combined,
    );
  }

  private stringifyModerationContext(value: unknown) {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private isPixazoPollTimeoutError(error: any) {
    const message = String(error?.message || '');
    return /Pixazo image generation poll timeout/i.test(message);
  }

  private extractPixazoRequestId(error: any): string | null {
    const direct = error?.pixazoRequestId;
    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim();
    }

    const responseRequestId = error?.response?.data?.request_id;
    if (typeof responseRequestId === 'string' && responseRequestId.trim()) {
      return responseRequestId.trim();
    }

    return null;
  }

  private getEpisodeAudioGenerationStatus(audioChunks: Record<string, any>[]) {
    if (!audioChunks?.length) {
      return 'ready_text_no_audio';
    }

    if (audioChunks.every((chunk) => chunk.status === 'ready' || chunk.status === 'ready_dry_run')) {
      return 'ready';
    }

    if (audioChunks.some((chunk) => chunk.status === 'failed')) {
      return 'ready_text_audio_partial';
    }

    return 'ready_text_audio_pending';
  }

  private getPreparedEpisodeGenerationStatus(audioChunks: Record<string, any>[]) {
    if (!audioChunks?.length) {
      return 'ready_text_no_audio';
    }

    if (audioChunks.every((chunk) => chunk.status === 'ready' || chunk.status === 'ready_dry_run')) {
      return audioChunks.some((chunk) => chunk.status === 'ready_dry_run') ? 'ready_dry_run' : 'ready';
    }

    if (audioChunks.some((chunk) => chunk.status === 'failed')) {
      return 'ready_text_audio_partial';
    }

    return 'ready_text_audio_pending';
  }

  private resolvePreparedEpisodeStatus(currentStatus: string, audioChunks: Record<string, any>[]) {
    if (currentStatus === 'used') {
      return 'used';
    }

    return this.getPreparedEpisodeGenerationStatus(audioChunks);
  }

  private isStaleProcessingJob(job: GenerationJob) {
    if (job.status !== 'processing') {
      return false;
    }

    const updatedAt = job.updatedAt?.getTime?.() || 0;
    return Date.now() - updatedAt > STALE_PROCESSING_JOB_TIMEOUT_MS;
  }

  private getJobLifecycle(job: GenerationJob) {
    const lifecycle = job.payload?.lifecycle || {};
    const rootCreatedAt = new Date(String(lifecycle.rootCreatedAt || job.createdAt || 0));
    const attempt = Math.max(1, Number(lifecycle.attempt || 1));
    return {
      attempt,
      rootCreatedAt: Number.isNaN(rootCreatedAt.getTime()) ? job.createdAt : rootCreatedAt,
    };
  }

  private buildJobLifecycle(history: GenerationJob[], now = new Date()) {
    const managedHistory = history.filter((job) => Boolean(job.payload?.lifecycle));
    if (!managedHistory.length) {
      return {
        attempt: 1,
        rootCreatedAt: now.toISOString(),
      };
    }

    const lifecycles = managedHistory.map((job) => this.getJobLifecycle(job));
    const rootCreatedAt = lifecycles.reduce(
      (earliest, lifecycle) => lifecycle.rootCreatedAt.getTime() < earliest.getTime() ? lifecycle.rootCreatedAt : earliest,
      lifecycles[0].rootCreatedAt,
    );
    return {
      attempt: Math.max(...lifecycles.map((lifecycle) => lifecycle.attempt)) + 1,
      rootCreatedAt: rootCreatedAt.toISOString(),
    };
  }

  private isGenerationJobExpired(job: GenerationJob, now = Date.now()) {
    return now - this.getJobLifecycle(job).rootCreatedAt.getTime() >= GENERATION_JOB_MAX_AGE_MS;
  }

  private canScheduleRetry(history: GenerationJob[], now = Date.now()) {
    if (!history.length) {
      return true;
    }

    const managedHistory = history.filter((job) => Boolean(job.payload?.lifecycle));
    if (!managedHistory.length) {
      return true;
    }

    const latest = [...history].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
    const lifecycle = this.getJobLifecycle(latest);
    return (
      latest.status === 'failed' &&
      lifecycle.attempt < GENERATION_JOB_MAX_ATTEMPTS &&
      !this.isGenerationJobExpired(latest, now) &&
      now - latest.updatedAt.getTime() >= GENERATION_JOB_RETRY_COOLDOWN_MS
    );
  }

  private async expireOverdueGenerationJobs(seasonId: string, jobType?: string) {
    const jobs = await this.generationJobsRepository.find({
      where: jobType
        ? { seasonId, jobType, status: In(['pending', 'processing']) }
        : { seasonId, status: In(['pending', 'processing']) },
      order: { updatedAt: 'ASC' },
    });

    let expired = 0;
    for (const job of jobs) {
      if (!this.isGenerationJobExpired(job)) {
        continue;
      }

      job.status = 'expired';
      job.error = `Generation job expired after ${Math.round(GENERATION_JOB_MAX_AGE_MS / 60000)} minutes`;
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);
      expired += 1;
      this.logger.warn(
        `[Worker] Expired job jobId=${job.jobId} jobType=${job.jobType} seasonId=${job.seasonId}`,
      );
    }

    return expired;
  }

  private async requeueProcessingJob(job: GenerationJob, reason: string) {
    const lifecycle = this.getJobLifecycle(job);
    if (this.isGenerationJobExpired(job) || lifecycle.attempt >= GENERATION_JOB_MAX_ATTEMPTS) {
      job.status = this.isGenerationJobExpired(job) ? 'expired' : 'failed';
      job.error = this.isGenerationJobExpired(job)
        ? `Generation job expired after ${Math.round(GENERATION_JOB_MAX_AGE_MS / 60000)} minutes`
        : `Generation job retry limit reached (${GENERATION_JOB_MAX_ATTEMPTS} attempts)`;
      job.updatedAt = new Date();
      await this.generationJobsRepository.save(job);
      this.logger.warn(
        `[Worker] Did not re-queue job jobId=${job.jobId} jobType=${job.jobType} seasonId=${job.seasonId} reason=${job.error}`,
      );
      return false;
    }

    job.status = 'pending';
    job.payload = {
      ...(job.payload || {}),
      lifecycle: {
        attempt: lifecycle.attempt + 1,
        rootCreatedAt: lifecycle.rootCreatedAt.toISOString(),
      },
    };
    job.updatedAt = new Date();
    await this.generationJobsRepository.save(job);
    this.logger.warn(
      `[Worker] Re-queued stale job jobId=${job.jobId} jobType=${job.jobType} seasonId=${job.seasonId} reason=${reason}`,
    );
    return true;
  }

  async recoverOrphanedJobsOnStartup() {
    const orphanBefore = new Date(Date.now() - STARTUP_ORPHAN_JOB_AGE_MS);
    const processingJobs = await this.generationJobsRepository.find({
      where: { status: 'processing' },
      order: { updatedAt: 'ASC' },
    });

    let recovered = 0;
    for (const job of processingJobs) {
      if (job.updatedAt && job.updatedAt.getTime() > orphanBefore.getTime()) {
        continue;
      }

      await this.requeueProcessingJob(job, 'startup orphan recovery');
      recovered += 1;
    }

    if (recovered > 0) {
      this.logger.warn(`[Worker] Recovered ${recovered} orphaned processing jobs on startup`);
    }

    return recovered;
  }

  private async waitForPreparedIllustration(
    seasonId: string,
    episode: Episode,
    hero: Hero | null,
    preparedEpisode: PreparedEpisode,
    timeoutMs = PREPARED_ILLUSTRATION_WAIT_TIMEOUT_MS,
  ) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const freshPrepared = await this.preparedEpisodesRepository.findOne({
        where: { preparedEpisodeId: preparedEpisode.preparedEpisodeId },
      });
      if (!freshPrepared) {
        return false;
      }

      const illustrationStatus = String(freshPrepared.payload?.preparedIllustration?.status || '');
      if (['ready', 'ready_dry_run'].includes(illustrationStatus)) {
        await this.attachPreparedIllustration(seasonId, episode, hero, freshPrepared);
        const hasIllustrationEntry = await this.storybookEntriesRepository.findOne({
          where: { seasonId, episodeId: episode.episodeId, entryType: 'episode_illustration' },
        });
        return Boolean(hasIllustrationEntry);
      }

      if (illustrationStatus === 'failed') {
        return false;
      }

      const inProgress = await this.isPreparedIllustrationInProgress(seasonId, freshPrepared);
      if (!inProgress) {
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, PREPARED_ILLUSTRATION_WAIT_POLL_MS));
      await this.processPendingGenerationJobs(seasonId, { limit: 2 });
    }

    return false;
  }

  private logGenerationFallback(scope: string, error: any) {
    const code = error?.code || error?.cause?.code || 'unknown';
    const message = error?.message || 'generation failed';
    console.warn(`${scope} generation failed, using fallback. ${code}: ${message}`);
  }

  private async persistEpisodeTtsResult(
    job: GenerationJob,
    episodeId: string,
    metadata: Record<string, any>,
    audioUrl: string,
    durationSeconds: number,
    dryRun: boolean,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const episode = await queryRunner.manager.findOne(Episode, {
        where: { episodeId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!episode) {
        throw new Error('Episode for TTS job was not found');
      }

      const { chunks: updatedAudioChunks, matched } = this.mergeAudioChunkState(
        episode.audioChunks || [],
        metadata.chunkId,
        dryRun ? 'ready_dry_run' : 'ready',
        audioUrl,
        durationSeconds,
      );
      if (!matched) {
        throw new Error(`Episode TTS chunk ${metadata.chunkId || 'unknown'} was not found`);
      }

      episode.audioChunks = updatedAudioChunks;
      episode.generationStatus = this.getEpisodeAudioGenerationStatus(updatedAudioChunks);
      episode.updatedAt = new Date();
      await queryRunner.manager.save(Episode, episode);

      job.status = dryRun ? 'ready_dry_run' : 'ready';
      job.result = {
        audioUrl,
        durationSeconds,
        chunkId: metadata.chunkId || null,
        dryRun,
      };
      job.error = null;
      job.updatedAt = new Date();
      await queryRunner.manager.save(GenerationJob, job);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async persistPreparedTtsResult(
    job: GenerationJob,
    preparedEpisodeId: string,
    metadata: Record<string, any>,
    audioUrl: string,
    durationSeconds: number,
    dryRun: boolean,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const prepared = await queryRunner.manager.findOne(PreparedEpisode, {
        where: { preparedEpisodeId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!prepared) {
        throw new Error('Prepared episode for TTS job was not found');
      }

      const preparedAudioChunks = Array.isArray(prepared.payload?.preparedAudioChunks)
        ? prepared.payload.preparedAudioChunks
        : [];
      const { chunks: updatedPreparedAudioChunks, matched } = this.mergeAudioChunkState(
        preparedAudioChunks,
        metadata.chunkId,
        dryRun ? 'ready_dry_run' : 'ready',
        audioUrl,
        durationSeconds,
      );
      if (!matched) {
        throw new Error(`Prepared TTS chunk ${metadata.chunkId || 'unknown'} was not found for ${preparedEpisodeId}`);
      }

      prepared.payload = {
        ...(prepared.payload || {}),
        preparedAudioChunks: updatedPreparedAudioChunks,
      };
      prepared.status = this.resolvePreparedEpisodeStatus(prepared.status, updatedPreparedAudioChunks);
      prepared.updatedAt = new Date();
      await queryRunner.manager.save(PreparedEpisode, prepared);

      job.status = dryRun ? 'ready_dry_run' : 'ready';
      job.result = {
        audioUrl,
        durationSeconds,
        chunkId: metadata.chunkId || null,
        dryRun,
      };
      job.error = null;
      job.updatedAt = new Date();
      await queryRunner.manager.save(GenerationJob, job);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private mergeAudioChunkState(
    audioChunks: Record<string, any>[],
    chunkId: string,
    status: 'ready' | 'ready_dry_run',
    audioUrl: string,
    durationSeconds: number,
  ) {
    let matched = false;
    const updated = (audioChunks || []).map((chunk) => {
      if (chunk.chunkId !== chunkId) {
        return chunk;
      }
      matched = true;
      return {
        ...chunk,
        status,
        audioUrl,
        ...(durationSeconds > 0 ? { durationSeconds } : {}),
      };
    });
    return { chunks: updated, matched };
  }

  private async reconcilePreparedAudioChunksForSeason(seasonId: string): Promise<number> {
    const readyJobs = await this.generationJobsRepository.find({
      where: {
        seasonId,
        jobType: 'prepared_tts_chunk',
        status: In(['ready', 'ready_dry_run']),
      },
    });

    const jobsByPrepared = new Map<string, GenerationJob[]>();
    for (const job of readyJobs) {
      const preparedEpisodeId = String(job.payload?.metadata?.preparedEpisodeId || '');
      if (!preparedEpisodeId) {
        continue;
      }
      const bucket = jobsByPrepared.get(preparedEpisodeId) || [];
      bucket.push(job);
      jobsByPrepared.set(preparedEpisodeId, bucket);
    }

    let fixedChunks = 0;
    for (const [preparedEpisodeId, jobs] of jobsByPrepared.entries()) {
      const prepared = await this.preparedEpisodesRepository.findOne({ where: { preparedEpisodeId } });
      if (!prepared) {
        continue;
      }

      const preparedAudioChunks = Array.isArray(prepared.payload?.preparedAudioChunks)
        ? [...prepared.payload.preparedAudioChunks]
        : [];
      let changed = false;

      for (const job of jobs) {
        const chunkId = String(job.payload?.metadata?.chunkId || job.result?.chunkId || '');
        const audioUrl = String(job.result?.audioUrl || '');
        if (!chunkId || !audioUrl) {
          continue;
        }

        const chunkIndex = preparedAudioChunks.findIndex((chunk) => chunk.chunkId === chunkId);
        if (chunkIndex === -1) {
          continue;
        }

        const chunk = preparedAudioChunks[chunkIndex];
        if ((chunk.status === 'ready' || chunk.status === 'ready_dry_run') && chunk.audioUrl) {
          continue;
        }

        preparedAudioChunks[chunkIndex] = {
          ...chunk,
          status: job.status === 'ready_dry_run' ? 'ready_dry_run' : 'ready',
          audioUrl,
        };
        changed = true;
        fixedChunks += 1;
      }

      if (changed) {
        prepared.payload = {
          ...(prepared.payload || {}),
          preparedAudioChunks,
        };
        prepared.status = this.resolvePreparedEpisodeStatus(prepared.status, preparedAudioChunks);
        prepared.updatedAt = new Date();
        await this.preparedEpisodesRepository.save(prepared);
      }
    }

    if (fixedChunks > 0) {
      this.logger.warn(`[PreparedAudio] Reconciled ${fixedChunks} prepared audio chunk(s) for season ${seasonId}`);
    }

    return fixedChunks;
  }

  private async reconcileEpisodeAudioChunksForSeason(seasonId: string): Promise<number> {
    const readyJobs = await this.generationJobsRepository.find({
      where: {
        seasonId,
        jobType: 'tts_chunk',
        status: In(['ready', 'ready_dry_run']),
      },
    });

    const jobsByEpisode = new Map<string, GenerationJob[]>();
    for (const job of readyJobs) {
      const episodeId = String(job.payload?.metadata?.episodeId || job.episodeId || '');
      if (!episodeId) {
        continue;
      }
      const bucket = jobsByEpisode.get(episodeId) || [];
      bucket.push(job);
      jobsByEpisode.set(episodeId, bucket);
    }

    let fixedChunks = 0;
    for (const [episodeId, jobs] of jobsByEpisode.entries()) {
      const episode = await this.episodesRepository.findOne({ where: { episodeId, seasonId } });
      if (!episode) {
        continue;
      }

      const audioChunks = Array.isArray(episode.audioChunks) ? [...episode.audioChunks] : [];
      let changed = false;

      for (const job of jobs) {
        const chunkId = String(job.payload?.metadata?.chunkId || job.result?.chunkId || '');
        const audioUrl = String(job.result?.audioUrl || '');
        if (!chunkId || !audioUrl) {
          continue;
        }

        const chunkIndex = audioChunks.findIndex((chunk) => chunk.chunkId === chunkId);
        if (chunkIndex === -1) {
          continue;
        }

        const chunk = audioChunks[chunkIndex];
        if ((chunk.status === 'ready' || chunk.status === 'ready_dry_run') && chunk.audioUrl) {
          continue;
        }

        audioChunks[chunkIndex] = {
          ...chunk,
          status: job.status === 'ready_dry_run' ? 'ready_dry_run' : 'ready',
          audioUrl,
        };
        changed = true;
        fixedChunks += 1;
      }

      if (changed) {
        episode.audioChunks = audioChunks;
        episode.generationStatus = this.getEpisodeAudioGenerationStatus(audioChunks);
        episode.updatedAt = new Date();
        await this.episodesRepository.save(episode);
      }
    }

    if (fixedChunks > 0) {
      this.logger.warn(`[EpisodeAudio] Reconciled ${fixedChunks} current audio chunk(s) for season ${seasonId}`);
    }

    return fixedChunks;
  }

  private async enqueueMissingPreparedTtsJobs(seasonId: string): Promise<number> {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    const preparedRows = await this.preparedEpisodesRepository.find({ where: { seasonId } });
    const existingJobs = await this.generationJobsRepository.find({
      where: { seasonId, jobType: 'prepared_tts_chunk' },
    });
    const jobsByChunk = new Map<string, GenerationJob[]>();
    for (const job of existingJobs) {
      const chunkId = String(job.payload?.metadata?.chunkId || '');
      if (!chunkId) {
        continue;
      }
      const history = jobsByChunk.get(chunkId) || [];
      history.push(job);
      jobsByChunk.set(chunkId, history);
    }

    const now = new Date();
    let enqueued = 0;
    for (const prepared of preparedRows) {
      if (['cancelled', 'used', 'failed'].includes(String(prepared.status || ''))) {
        continue;
      }
      const pendingChunks = (prepared.payload?.preparedAudioChunks || []).filter(
        (chunk) => chunk?.text && (!chunk.audioUrl || chunk.status === 'pending' || chunk.status === 'failed'),
      );
      const missingChunks = pendingChunks.filter((chunk) => {
        const history = jobsByChunk.get(String(chunk.chunkId || '')) || [];
        return !history.length || this.canScheduleRetry(history, now.getTime());
      });
      if (!missingChunks.length) {
        continue;
      }

      await this.enqueuePreparedTtsJobs(
        seasonId,
        prepared.preparedEpisodeId,
        missingChunks,
        now,
        season?.childProfile?.languageLevel,
        jobsByChunk,
      );
      enqueued += missingChunks.length;
    }

    if (enqueued > 0) {
      this.logger.warn(`[PreparedAudio] Enqueued ${enqueued} missing prepared TTS chunk job(s) for season ${seasonId}`);
    }

    return enqueued;
  }

  private async enqueueMissingEpisodeTtsJobs(seasonId: string, episodeNumber?: number): Promise<number> {
    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    const episodes = await this.episodesRepository.find({
      where: { seasonId, episodeNumber: episodeNumber || season?.currentEpisodeNumber || 1 },
    });
    const existingJobs = await this.generationJobsRepository.find({
      where: { seasonId, jobType: 'tts_chunk' },
      order: { updatedAt: 'ASC' },
    });
    const jobsByChunk = new Map<string, GenerationJob[]>();
    for (const job of existingJobs) {
      const chunkId = String(job.payload?.metadata?.chunkId || '');
      if (!chunkId) {
        continue;
      }
      const history = jobsByChunk.get(chunkId) || [];
      history.push(job);
      jobsByChunk.set(chunkId, history);
    }

    const now = new Date();
    let enqueued = 0;
    for (const episode of episodes) {
      const pendingChunks = (episode.audioChunks || []).filter(
        (chunk) => chunk?.text && (!chunk.audioUrl || chunk.status === 'pending' || chunk.status === 'failed'),
      );
      const missingChunks = pendingChunks.filter((chunk) => {
        const history = jobsByChunk.get(String(chunk.chunkId || '')) || [];
        return !history.length || this.canScheduleRetry(history, now.getTime());
      });
      if (!missingChunks.length) {
        continue;
      }

      await this.enqueueTtsJobs(
        seasonId,
        episode.episodeId,
        missingChunks,
        now,
        season?.childProfile?.languageLevel,
        jobsByChunk,
      );
      enqueued += missingChunks.length;
    }

    if (enqueued > 0) {
      this.logger.warn(`[EpisodeAudio] Enqueued ${enqueued} missing current TTS chunk job(s) for season ${seasonId}`);
    }

    return enqueued;
  }

  private async enqueueMissingEpisodeIllustrationJobs(seasonId: string, episodeNumber?: number): Promise<number> {
    const hero = await this.heroesRepository.findOne({ where: { seasonId } });
    if (!hero?.heroReferenceImageUrl) {
      return 0;
    }

    const season = await this.seasonsRepository.findOne({ where: { seasonId } });
    if (!season?.currentEpisodeNumber) {
      return 0;
    }

    const episodes = await this.episodesRepository.find({
      where: { seasonId, episodeNumber: episodeNumber || season.currentEpisodeNumber },
      order: { episodeNumber: 'ASC' },
    });

    let enqueued = 0;
    for (const episode of episodes) {
      if (!episode.illustrationCandidate?.shouldGenerate || !episode.illustrationCandidate?.moment) {
        continue;
      }

      const beforePending = await this.generationJobsRepository.count({
        where: { seasonId, episodeId: episode.episodeId, jobType: 'image_generation', status: 'pending' },
      });
      await this.prepareEpisodeIllustration(seasonId, episode, hero);
      const afterPending = await this.generationJobsRepository.count({
        where: { seasonId, episodeId: episode.episodeId, jobType: 'image_generation', status: 'pending' },
      });
      if (afterPending > beforePending) {
        enqueued += afterPending - beforePending;
      }
    }

    if (enqueued > 0) {
      this.logger.warn(`[Illustration] Enqueued ${enqueued} missing current illustration job(s) for season ${seasonId}`);
    }

    return enqueued;
  }

  private isRetryablePreparedEpisodeProseError(error: any) {
    const code = String(error?.code || error?.cause?.code || '').toUpperCase();
    const status = Number(error?.response?.status || 0);
    const message = String(error?.message || '').toLowerCase();

    if (['ECONNRESET', 'ENOTFOUND', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) {
      return true;
    }

    if (status === 429 || message.includes('rate limit')) {
      return true;
    }

    return false;
  }

  private formatGenerationError(error: any) {
    const code = error?.code || error?.cause?.code || 'unknown';
    const message = error?.message || 'generation failed';
    return `${code}: ${message}`;
  }

  private logPipelineStep(event: string, data: Record<string, unknown>) {
    this.logger.logEpisodePipeline(event, data);
  }

  private logGenerationJobFailed(job: GenerationJob, error: string) {
    this.logPipelineStep('generation_job_failed', {
      jobId: job.jobId,
      jobType: job.jobType,
      seasonId: job.seasonId,
      episodeId: job.episodeId,
      error,
    });
    this.logger.error(
      `[GenerationJob] ${job.jobType} failed jobId=${job.jobId} seasonId=${job.seasonId} | ${error}`,
    );
  }

  private async refundIllustrationUnlockIfNeeded(
    job: GenerationJob,
    illustrationId: string,
    episodeId: string | null,
  ) {
    const season = await this.seasonsRepository.findOne({ where: { seasonId: job.seasonId } });
    if (!season?.ownerUserId) {
      return;
    }

    const targetEpisodeId = episodeId || job.episodeId || null;
    const debitEntries = await this.crystalLedgerRepository.find({
      where: {
        seasonId: job.seasonId,
        ownerUserId: season.ownerUserId,
        reason: 'illustration_unlock',
      },
      order: { createdAt: 'DESC' },
    });
    const debitEntry =
      debitEntries.find((entry) => illustrationId && entry.metadata?.illustrationId === illustrationId) ||
      (targetEpisodeId
        ? debitEntries.find((entry) => entry.metadata?.episodeId === targetEpisodeId)
        : null);
    if (!debitEntry) {
      return;
    }

    const refundEntries = await this.crystalLedgerRepository.find({
      where: {
        seasonId: job.seasonId,
        ownerUserId: season.ownerUserId,
        reason: 'illustration_unlock_refund',
      },
    });
    if (
      refundEntries.some(
        (entry) =>
          entry.metadata?.sourceLedgerEntryId === debitEntry.ledgerEntryId ||
          (illustrationId && entry.metadata?.illustrationId === illustrationId) ||
          (targetEpisodeId &&
            entry.metadata?.episodeId === targetEpisodeId &&
            entry.metadata?.sourceLedgerEntryId === debitEntry.ledgerEntryId),
      )
    ) {
      return;
    }

    await this.crystalLedgerRepository.save(
      this.crystalLedgerRepository.create({
        ledgerEntryId: uuidv4(),
        walletId: debitEntry.walletId,
        ownerUserId: season.ownerUserId,
        seasonId: job.seasonId,
        direction: 'credit',
        amount: debitEntry.amount,
        reason: 'illustration_unlock_refund',
        metadata: {
          illustrationId: debitEntry.metadata?.illustrationId || illustrationId || null,
          episodeId: targetEpisodeId || debitEntry.metadata?.episodeId || null,
          episodeNumber: debitEntry.metadata?.episodeNumber || null,
          sourceLedgerEntryId: debitEntry.ledgerEntryId,
          failedJobId: job.jobId,
        },
        createdAt: new Date(),
      }),
    );

    await this.getOrCreateCrystalWallet(season.ownerUserId, job.seasonId);
    this.logPipelineStep('illustration_unlock_refunded', {
      seasonId: job.seasonId,
      episodeId: targetEpisodeId || debitEntry.metadata?.episodeId || null,
      illustrationId: debitEntry.metadata?.illustrationId || illustrationId || null,
      amount: debitEntry.amount,
      failedJobId: job.jobId,
    });
  }

  private buildDryRunAudioUrl(chunkId: string) {
    const payload = Buffer.from(`StoryHop dry-run audio placeholder: ${chunkId}`).toString('base64');
    return `data:audio/mpeg;base64,${payload}`;
  }

  private buildDryRunImageUrl(illustrationId: string) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720"><rect width="100%" height="100%" fill="#FDE7F3"/><rect x="60" y="60" width="840" height="600" rx="36" fill="#FFF7ED"/><text x="120" y="220" font-size="44" font-family="Arial, sans-serif" fill="#7C2D12">StoryHop illustration placeholder</text><text x="120" y="300" font-size="30" font-family="Arial, sans-serif" fill="#9A3412">${illustrationId}</text></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  private buildFallbackFramework(childProfile: Record<string, any>, seasonSetup: Record<string, any>) {
    const childName = childProfile.childName || 'The hero';
    const world = seasonSetup.world || seasonSetup.theme || 'a magical world';
    const vocabularyFocus = Array.isArray(seasonSetup.vocabularyFocus) ? seasonSetup.vocabularyFocus : [];

    return {
      seasonPremise: `${childName} enters ${world} and discovers that a fragile balance is breaking apart.`,
      centralProblem: `A vital force inside ${world} is fading, and ${childName} must help restore it before the world loses its warmth, memory, and connection.`,
      dramaticQuestion: `Can ${childName} learn to help others well enough to restore ${world} before the damage becomes permanent?`,
      externalStakes: `${world} will become dim, confused, and fragmented if the heroes fail.`,
      emotionalStakes: `${childName} risks feeling helpless and disconnected from friends who need support.`,
      heroWant: `${childName} wants to solve problems quickly and be seen as brave right away.`,
      heroNeed: `${childName} needs to learn patience, listening, and teamwork.`,
      antagonisticForce: {
        type: 'mystery',
        description: `A spreading wave of sleepiness and confusion keeps hiding the truth and making each fix incomplete.`,
      },
      rulesOfWorld: [
        'Big changes happen only when characters act together.',
        'Words used in meaningful actions can restore lost energy.',
        'Shortcuts create new problems later.',
      ],
      incitingIncident: `${childName} sees the first clear sign that the world is shutting down in a way adults cannot ignore.`,
      pointOfNoReturn: `${childName} accepts a mission that ties the season problem directly to the hero's choices.`,
      miniArcPlan: [
        {
          arcNumber: 1,
          episodesRange: '1-5',
          localGoal: 'Understand what is breaking and save one small part of the world.',
          mainObstacle: 'The heroes do not yet understand the rules of the world.',
          storyFunction: 'setup',
          vocabularyFocus,
          stateChangesExpected: ['The hero commits to solving the season problem.'],
        },
        {
          arcNumber: 2,
          episodesRange: '6-10',
          localGoal: 'Build trust with helpers and gather missing clues.',
          mainObstacle: 'The problem spreads faster than the heroes expect.',
          storyFunction: 'escalation',
          vocabularyFocus,
          stateChangesExpected: ['New allies appear.', 'The cost of failure becomes clearer.'],
        },
        {
          arcNumber: 3,
          episodesRange: '11-15',
          localGoal: 'Test a bold plan that seems like it might solve everything.',
          mainObstacle: 'The heroes misunderstand the real cause of the crisis.',
          storyFunction: 'reversal',
          vocabularyFocus,
          stateChangesExpected: ['The midpoint reveals the problem is deeper than expected.'],
        },
        {
          arcNumber: 4,
          episodesRange: '16-20',
          localGoal: 'Recover from failure and repair damaged relationships.',
          mainObstacle: 'Confidence drops after a painful setback.',
          storyFunction: 'recovery',
          vocabularyFocus,
          stateChangesExpected: ['The hero learns to act with more care and cooperation.'],
        },
        {
          arcNumber: 5,
          episodesRange: '21-24',
          localGoal: 'Face the final challenge and restore the world.',
          mainObstacle: 'The last step requires everything learned so far.',
          storyFunction: 'finale preparation',
          vocabularyFocus,
          stateChangesExpected: ['The season problem is resolved through earned growth.'],
        },
      ],
      midpointReversal: `The heroes achieve a partial victory, then discover that the true source of the crisis is closer and more personal than they thought.`,
      lowPoint: `${childName} believes the world may not recover and feels responsible for making things worse.`,
      finalChallenge: `${childName} must unite friends, use the season's key action words, and choose care over speed in the final confrontation.`,
      resolution: `${childName} and the team restore the world by combining courage, listening, and meaningful action, proving that growth is part of the solution.`,
      characterChange: `${childName} becomes more patient, thoughtful, and able to help others under pressure.`,
      safetyBoundaries: ['No gore', 'No real-world politics', 'No diagnosis language', 'No traumatic harm'],
      toneGuide: seasonSetup.preferredTone || 'Warm, adventurous, emotionally safe',
      recurringMotifs: ['glowing maps', 'shared lantern light', 'wake up', 'help together'],
    };
  }

  private buildFallbackSeasonBible(
    childProfile: Record<string, any>,
    seasonSetup: Record<string, any>,
    framework: Record<string, any>,
  ) {
    return {
      worldOverview: `${seasonSetup.world} is a place where words, choices, and friendship change the environment in visible ways.`,
      worldRules: framework.rulesOfWorld || [],
      mainLocations: [
        {
          name: 'The Quiet Center',
          description: 'A once-bright place where the season problem is most visible.',
          storyUse: 'Signals the health of the whole world.',
        },
        {
          name: 'The Helpers Path',
          description: 'A route where the hero meets allies and solves practical obstacles.',
          storyUse: 'Supports vocabulary repetition through action scenes.',
        },
      ],
      mainCharacters: [
        {
          name: childProfile.childName || 'Hero',
          role: 'hero',
          ageYears: Number(childProfile.childAge) || 9,
          personality: 'Curious, brave, still learning patience.',
          relationshipToHero: 'self',
          visualDescription: 'child hero with a readable silhouette, clear outfit, and visible expressive face',
        },
        {
          name: 'Pip',
          role: 'companion',
          ageYears: null,
          personality: 'Encouraging, observant, gently funny.',
          relationshipToHero: 'trusted companion',
          visualDescription: 'small friendly companion with a simple recognizable shape and warm expression',
        },
      ],
      seasonContinuityRules: [
        'Each episode must move the central problem forward.',
        'Vocabulary is introduced through meaningful action.',
        'Choices can change relationships, confidence, and tactics.',
      ],
      vocabularyPlan: {
        coreWords: seasonSetup.vocabularyFocus || [],
        actionPhrases: ['help me', 'wake up', 'let us try', 'we can do this'],
        reviewCadence: 'Repeat core words in action, recovery, and cooperation scenes across mini-arcs.',
      },
      rewardLogic: {
        crystalThemes: ['helping others', 'trying brave choices', 'using target vocabulary in context'],
        unlockMoments: ['restoring a place', 'solving a conflict', 'finishing a mini-arc'],
      },
      illustrationStyleGuide: {
        visualTone: 'Storybook warmth with readable silhouettes and playful magic',
        colorMood: 'Peach, gold, sky blue, and soft night tones',
        avoid: ['hyperrealism', 'dark horror lighting', 'chaotic crowd scenes'],
      },
    };
  }

  private buildFallbackEpisodeOutline(framework: Record<string, any>, seasonBible: Record<string, any>) {
    const baseEpisodes = [
      ['The First Strange Silence', 'The hero notices the world is changing and chooses to investigate.'],
      ['A Small Part Can Be Saved', 'A local fix works, but only for a moment.'],
      ['The Map That Forgets', 'The heroes lose certainty and must trust each other.'],
      ['A Friend Who Knows More', 'A helper reveals a clue with a cost.'],
      ['The Fast Plan Fails', 'A rushed solution creates a bigger problem.'],
    ];

    const episodes = Array.from({ length: 96 }, (_, index) => {
      const item = baseEpisodes[index % baseEpisodes.length];
      return {
        episodeNumber: index + 1,
        miniArcNumber: Math.floor(index / 16) + 1,
        title: `${item[0]} ${index + 1}`,
        storyPurpose: item[1],
        conflict: framework.centralProblem,
        vocabularyFocus: seasonBible.vocabularyPlan?.coreWords || [],
        expectedChoiceTheme: index % 2 === 0 ? 'brave' : 'kind',
        stateChangeGoal: 'Move the hero closer to understanding the season problem.',
        illustrationOpportunity: 'A strong emotional action beat with visible world change.',
        cliffhangerOrHook: 'A clue appears that changes the heroes understanding of the crisis.',
      };
    });

    return {
      episodeCount: 96,
      episodes,
      continuityCheck: {
        centralProblemProgression: 'The season moves through six long mini-arcs from discovery to earned resolution.',
        midpointEpisode: 48,
        lowPointEpisode: 78,
        finaleEpisodes: [95, 96],
      },
    };
  }

  private buildFallbackHero(
    preferences: Record<string, any>,
    framework: Record<string, any>,
    seasonSetup: Record<string, any>,
    childProfile?: Record<string, any>,
  ) {
    const name = preferences.preferredName || 'Nova';
    const traitList = preferences.traits?.length ? preferences.traits : ['curious', 'kind', 'brave'];
    const colors = [preferences.favoriteColor || 'gold', 'sky blue', 'coral'];
    const companionType = preferences.companion || 'tiny lantern bird';
    const heroType = preferences.heroType || 'young explorer';

    return {
      heroProfile: {
        name,
        ageYears: Number(childProfile?.childAge) || Number(preferences.ageYears) || 9,
        ageFeel: 'young explorer',
        shortDescription: `${name} is a ${heroType} from ${seasonSetup.world || 'a magical place'} who steps into the season crisis with a warm heart and restless curiosity.`,
        personality: traitList,
        motivation: framework.heroWant || `${name} wants to help quickly and prove they can make a difference.`,
        strength: traitList[0] || 'curiosity',
        gentleWeakness: framework.heroNeed || `${name} sometimes rushes before listening carefully.`,
        companion: {
          name: 'Pip',
          type: companionType,
          personality: 'loyal, bright, encouraging',
        },
        relationshipToSeasonProblem: `${name} is emotionally tied to the season problem because helping others is the key to resolving it.`,
      },
      heroVisualBrief: {
        speciesOrType: heroType,
        silhouette: 'soft rounded silhouette with a confident forward lean',
        faceAndExpression: 'large friendly eyes, alert smile, expressive eyebrows',
        hairFurOrSurface: 'soft textured hair with tidy adventurous shape',
        outfit: `practical adventure outfit with ${preferences.favoriteColor || 'gold'} details`,
        signatureAccessory: preferences.accessory || 'satchel',
        mainColors: colors,
        scaleAndProportions: 'child-safe proportions with slightly oversized head and hands for expressiveness',
        doNotShow: ['weapons', 'horror details', 'adult styling'],
        consistencyNotes: [
          `Always keep the ${preferences.accessory || 'satchel'} visible when possible`,
          `Use ${preferences.favoriteColor || 'gold'} as the accent color`,
          'Keep the companion close in emotional scenes',
        ],
      },
    };
  }

  private buildFallbackHeroReferenceImage(heroProfile: Record<string, any>, heroVisualBrief: Record<string, any>) {
    const accent = this.normalizeColor(heroVisualBrief.mainColors?.[0] || '#f59e0b');
    const secondary = this.normalizeColor(heroVisualBrief.mainColors?.[1] || '#7dd3fc');
    const bg = this.normalizeColor(heroVisualBrief.mainColors?.[2] || '#fde68a');
    const accessory = this.escapeXml(heroVisualBrief.signatureAccessory || 'satchel');
    const heroName = this.escapeXml(heroProfile.name || 'Hero');

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">
  <rect width="720" height="960" rx="48" fill="${bg}" />
  <circle cx="360" cy="220" r="130" fill="#fff8ef" />
  <ellipse cx="360" cy="600" rx="190" ry="240" fill="${accent}" />
  <ellipse cx="360" cy="535" rx="110" ry="140" fill="#fff8ef" />
  <circle cx="318" cy="205" r="14" fill="#1f2937" />
  <circle cx="402" cy="205" r="14" fill="#1f2937" />
  <path d="M315 260 Q360 300 405 260" stroke="#1f2937" stroke-width="10" fill="none" stroke-linecap="round" />
  <path d="M250 145 Q360 70 470 145" stroke="${secondary}" stroke-width="34" fill="none" stroke-linecap="round" />
  <rect x="280" y="455" width="160" height="170" rx="48" fill="${secondary}" opacity="0.88" />
  <rect x="188" y="565" width="72" height="220" rx="36" fill="${accent}" />
  <rect x="460" y="565" width="72" height="220" rx="36" fill="${accent}" />
  <rect x="170" y="420" width="92" height="220" rx="40" fill="${accent}" transform="rotate(18 170 420)" />
  <rect x="458" y="420" width="92" height="220" rx="40" fill="${accent}" transform="rotate(-18 458 420)" />
  <rect x="430" y="515" width="120" height="110" rx="26" fill="#fff8ef" stroke="#1f2937" stroke-width="6" />
  <text x="490" y="565" text-anchor="middle" font-size="20" font-family="Trebuchet MS, Arial, sans-serif" fill="#1f2937">${accessory}</text>
  <text x="360" y="860" text-anchor="middle" font-size="42" font-weight="700" font-family="Trebuchet MS, Arial, sans-serif" fill="#1f2937">${heroName}</text>
</svg>`.trim();

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }


  private normalizeColor(value: string) {
    const palette: Record<string, string> = {
      gold: '#f59e0b',
      yellow: '#facc15',
      coral: '#fb7185',
      pink: '#f472b6',
      blue: '#60a5fa',
      'sky blue': '#7dd3fc',
      green: '#4ade80',
      mint: '#6ee7b7',
      purple: '#c084fc',
      orange: '#fb923c',
      red: '#f87171',
    };

    return palette[value?.toLowerCase?.() || ''] || value || '#f59e0b';
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
