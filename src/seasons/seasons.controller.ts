import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SeasonsService } from './seasons.service';
import { CurrentUser } from '../users/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { SeasonOwnerGuard } from '../users/season-owner.guard';
import { SessionAuthGuard } from '../users/session-auth.guard';
import { assertMaintenanceRouteEnabled } from '../security/maintenance-route';

@Controller('seasons')
@UseGuards(SessionAuthGuard, SeasonOwnerGuard)
export class SeasonsController {
  constructor(private readonly seasonsService: SeasonsService) {}

  @Post('hero-preview')
  async previewHero(
    @Body()
    body: {
      world: string;
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
    },
    @CurrentUser() user: User,
  ) {
    try {
      return await this.seasonsService.previewHero({ ...body, ownerUserId: user.userId });
    } catch (error) {
      console.error('Hero preview failed', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Hero preview failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('start')
  async startSeason(
    @Body()
    body: {
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
    },
    @CurrentUser() user: User,
  ) {
    try {
      return await this.seasonsService.startSeason({ ...body, ownerUserId: user.userId });
    } catch (error) {
      console.error('Season start failed', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Season start failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('users/me')
  async getSeasonsForUser(@CurrentUser() user: User) {
    try {
      return await this.seasonsService.getSeasonsForUser(user.userId);
    } catch (error) {
      console.error('Get seasons failed', error);
      throw new HttpException(error?.message || 'Get seasons failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('visuals/backfill-all')
  async backfillAllSeasonVisuals(
    @Body() body: { forceFailedCovers?: boolean } = {},
  ) {
    assertMaintenanceRouteEnabled();
    try {
      return await this.seasonsService.backfillAllSeasonVisuals(body || {});
    } catch (error) {
      console.error('Backfill all season visuals failed', error);
      throw new HttpException(
        error?.message || 'Backfill all season visuals failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':seasonId')
  async getSeason(@Param('seasonId') seasonId: string, @Query('episodeNumber') episodeNumber?: string) {
    try {
      const parsedEpisodeNumber = Number(episodeNumber);
      return await this.seasonsService.getSeason(seasonId, {
        reconcileCurrentEpisodeMedia: true,
        episodeNumber: Number.isInteger(parsedEpisodeNumber) && parsedEpisodeNumber > 0 ? parsedEpisodeNumber : undefined,
      });
    } catch (error) {
      console.error('Get season failed', error);
      throw new HttpException(error?.message || 'Get season failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':seasonId/storybook')
  async getStorybook(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.getStorybook(seasonId);
    } catch (error) {
      console.error('Get storybook failed', error);
      throw new HttpException(error?.message || 'Get storybook failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':seasonId/prepared-next')
  async getPreparedNext(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.getPreparedNext(seasonId);
    } catch (error) {
      console.error('Get prepared next failed', error);
      throw new HttpException(error?.message || 'Get prepared next failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':seasonId/bonus-practice/summary')
  async getBonusPracticeSummary(
    @Param('seasonId') seasonId: string,
    @Query('origin') origin?: 'story' | 'home',
  ) {
    try {
      return await this.seasonsService.getBonusPracticeSummary(seasonId, origin || 'story');
    } catch (error) {
      console.error('Get bonus practice summary failed', error);
      throw new HttpException(error?.message || 'Get bonus practice summary failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':seasonId/bonus-practice/speaking')
  async getSpeakingPractice(
    @Param('seasonId') seasonId: string,
    @Query('origin') origin?: 'story' | 'home',
  ) {
    try {
      return await this.seasonsService.getSpeakingPractice(seasonId, origin || 'story');
    } catch (error) {
      console.error('Get speaking practice failed', error);
      throw new HttpException(error?.message || 'Get speaking practice failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/bonus-practice/speaking/attempt')
  async submitSpeakingPractice(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      origin?: 'story' | 'home';
      itemId?: string;
      episodeId?: string;
      targetPhrase?: string;
      transcript?: string;
    },
  ) {
    try {
      return await this.seasonsService.submitSpeakingPracticeAttempt(seasonId, body || {});
    } catch (error) {
      console.error('Submit speaking practice failed', error);
      throw new HttpException(error?.message || 'Submit speaking practice failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/bonus-practice/speaking/skip')
  async skipSpeakingPractice(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      origin?: 'story' | 'home';
      type?: string;
      itemId?: string;
      episodeId?: string;
      targetPhrase?: string;
    },
  ) {
    try {
      return await this.seasonsService.skipSpeakingPractice(seasonId, body || {});
    } catch (error) {
      console.error('Skip speaking practice failed', error);
      throw new HttpException(error?.message || 'Skip speaking practice failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':seasonId/bonus-practice/writing')
  async getWritingPractice(
    @Param('seasonId') seasonId: string,
    @Query('origin') origin?: 'story' | 'home',
  ) {
    try {
      return await this.seasonsService.getWritingPractice(seasonId, origin || 'story');
    } catch (error) {
      console.error('Get writing practice failed', error);
      throw new HttpException(error?.message || 'Get writing practice failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/bonus-practice/writing/prompt-shown')
  async markWritingPromptShown(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.markWritingPracticePromptShown(seasonId);
    } catch (error) {
      console.error('Mark writing prompt shown failed', error);
      throw new HttpException(error?.message || 'Mark writing prompt shown failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/bonus-practice/writing/attempt')
  async submitWritingPractice(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      answer?: string;
      mode?: 'audio' | 'translation';
    },
  ) {
    try {
      return await this.seasonsService.submitWritingPracticeAttempt(seasonId, body || {});
    } catch (error) {
      console.error('Submit writing practice failed', error);
      throw new HttpException(error?.message || 'Submit writing practice failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/bonus-practice/writing/hint')
  async requestWritingHint(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      hintType?: 'first_letter' | 'translation';
    },
  ) {
    try {
      return await this.seasonsService.requestWritingPracticeHint(seasonId, body?.hintType);
    } catch (error) {
      console.error('Request writing hint failed', error);
      throw new HttpException(error?.message || 'Request writing hint failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/bonus-practice/writing/reveal')
  async revealWritingAnswer(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.revealWritingPracticeAnswer(seasonId);
    } catch (error) {
      console.error('Reveal writing answer failed', error);
      throw new HttpException(error?.message || 'Reveal writing answer failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/bonus-practice/writing/skip')
  async skipWritingPractice(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.skipWritingPractice(seasonId);
    } catch (error) {
      console.error('Skip writing practice failed', error);
      throw new HttpException(error?.message || 'Skip writing practice failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/bootstrap')
  async bootstrapSeason(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.bootstrapSeasonFromWizard(seasonId);
    } catch (error) {
      console.error('Bootstrap season failed', error);
      throw new HttpException(error?.message || 'Bootstrap season failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/repair-protagonist')
  async repairProtagonist(@Param('seasonId') seasonId: string) {
    assertMaintenanceRouteEnabled();
    try {
      return await this.seasonsService.rebuildSeasonForProtagonistConsistency(seasonId);
    } catch (error) {
      console.error('Repair protagonist failed', error);
      throw new HttpException(error?.message || 'Repair protagonist failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/visuals/backfill')
  async backfillSeasonVisuals(
    @Param('seasonId') seasonId: string,
    @Body() body: { forceCover?: boolean } = {},
  ) {
    assertMaintenanceRouteEnabled();
    try {
      return await this.seasonsService.backfillSeasonVisuals(seasonId, body || {});
    } catch (error) {
      console.error('Backfill season visuals failed', error);
      throw new HttpException(error?.message || 'Backfill season visuals failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/archive')
  async archiveSeason(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.setSeasonArchived(seasonId, true);
    } catch (error) {
      console.error('Archive season failed', error);
      throw new HttpException(error?.message || 'Archive season failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/unarchive')
  async unarchiveSeason(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.setSeasonArchived(seasonId, false);
    } catch (error) {
      console.error('Unarchive season failed', error);
      throw new HttpException(error?.message || 'Unarchive season failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/learning-events')
  async recordLearningEvent(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      episodeId?: string;
      eventType: string;
      payload?: Record<string, any>;
    },
  ) {
    if (!['audio_listen', 'audio_complete'].includes(body?.eventType)) {
      throw new BadRequestException('Unsupported client learning event');
    }
    try {
      return await this.seasonsService.recordLearningEvent(seasonId, body);
    } catch (error) {
      console.error('Record learning event failed', error);
      throw new HttpException(error?.message || 'Record learning event failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/hero')
  async generateHero(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      preferredName: string;
      heroType: string;
      traits: string[];
      companion: string;
      favoriteColor: string;
      accessory: string;
    },
  ) {
    try {
      return await this.seasonsService.generateHero(seasonId, body);
    } catch (error) {
      console.error('Generate hero failed', error);
      throw new HttpException(error?.message || 'Generate hero failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/episodes/first')
  async generateFirstEpisode(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.generateFirstEpisode(seasonId);
    } catch (error) {
      console.error('Generate first episode failed', error);
      throw new HttpException(error?.message || 'Generate first episode failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':seasonId/episodes/current')
  async getCurrentEpisode(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.getCurrentEpisode(seasonId);
    } catch (error) {
      console.error('Get current episode failed', error);
      throw new HttpException(error?.message || 'Get current episode failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/episodes/:episodeId/choices')
  async applyEpisodeChoice(
    @Param('seasonId') seasonId: string,
    @Param('episodeId') episodeId: string,
    @Body()
    body: {
      choiceId: string;
    },
  ) {
    try {
      return await this.seasonsService.applyEpisodeChoice(seasonId, episodeId, body.choiceId);
    } catch (error) {
      console.error('Apply episode choice failed', error);
      throw new HttpException(error?.message || 'Apply episode choice failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/storybook/unlock')
  async unlockIllustration(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      episodeId: string;
    },
  ) {
    try {
      return await this.seasonsService.unlockIllustration(seasonId, body.episodeId);
    } catch (error) {
      console.error('Unlock illustration failed', error);
      throw new HttpException(error?.message || 'Unlock illustration failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/storybook/:entryId/favorite')
  async setStorybookFavorite(
    @Param('seasonId') seasonId: string,
    @Param('entryId') entryId: string,
    @Body() body: { favorited?: boolean },
  ) {
    try {
      return await this.seasonsService.setStorybookEntryFavorite(
        seasonId,
        entryId,
        body?.favorited !== false,
      );
    } catch (error) {
      console.error('Set storybook favorite failed', error);
      throw new HttpException(
        error?.message || 'Set storybook favorite failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':seasonId/voice-attempts')
  async recordVoiceAttempt(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      episodeId?: string;
      targetPhrase?: string;
      transcript?: string;
    },
  ) {
    try {
      return await this.seasonsService.recordVoiceAttempt(seasonId, body || {});
    } catch (error) {
      console.error('Record voice attempt failed', error);
      throw new HttpException(error?.message || 'Record voice attempt failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':seasonId/characters')
  async getSeasonCharacters(@Param('seasonId') seasonId: string) {
    try {
      return await this.seasonsService.getSeasonCharacters(seasonId);
    } catch (error) {
      console.error('Get season characters failed', error);
      throw new HttpException(error?.message || 'Get season characters failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/characters')
  async upsertSeasonCharacter(
    @Param('seasonId') seasonId: string,
    @Body() body: Record<string, any>,
  ) {
    assertMaintenanceRouteEnabled();
    try {
      return await this.seasonsService.upsertSeasonCharacter(seasonId, body);
    } catch (error) {
      console.error('Upsert season character failed', error);
      throw new HttpException(error?.message || 'Upsert season character failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/characters/backfill')
  async backfillSeasonCharacters(@Param('seasonId') seasonId: string) {
    assertMaintenanceRouteEnabled();
    try {
      return await this.seasonsService.backfillSeasonCharacters(seasonId);
    } catch (error) {
      console.error('Backfill season characters failed', error);
      throw new HttpException(error?.message || 'Backfill season characters failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':seasonId/jobs/process')
  async processPendingJobs(
    @Param('seasonId') seasonId: string,
    @Body()
    body: {
      limit?: number;
      dryRun?: boolean;
      jobType?: string;
    },
  ) {
    try {
      return await this.seasonsService.processPendingGenerationJobs(seasonId, body || {});
    } catch (error) {
      console.error('Process generation jobs failed', error);
      throw new HttpException(error?.message || 'Process generation jobs failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
