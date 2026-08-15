import { Body, Controller, Get, HttpException, HttpStatus, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SeasonsService } from './seasons.service';
import { CurrentUser } from '../users/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { SessionAuthGuard } from '../users/session-auth.guard';
import { UsersService } from '../users/users.service';

@Controller('users')
@UseGuards(SessionAuthGuard)
export class ProgressController {
  constructor(
    private readonly seasonsService: SeasonsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('me/settings')
  async getSettings(@CurrentUser() user: User) {
    const [profile, preferences] = await Promise.all([
      this.usersService.getChildProfile(user.userId),
      this.usersService.getPreferences(user.userId),
    ]);
    return {
      profile: profile ? {
        complete: this.usersService.isChildProfileComplete(profile),
        displayName: profile.displayName,
        age: profile.age,
        gender: profile.gender,
        englishLevel: profile.englishLevel,
      } : null,
      preferences: {
        interfaceLanguage: preferences.interfaceLanguage,
        playbackRate: Number(preferences.playbackRate),
        readingTextSize: preferences.readingTextSize,
      },
      account: { accountType: user.accountType, email: user.email || null },
    };
  }

  @Post('me/settings')
  async updateSettings(@CurrentUser() user: User, @Body() body: { childName?: string }) {
    user.childName = String(body.childName || '').trim().slice(0, 80);
    const saved = await this.usersService.save(user);
    return { childName: saved.childName, email: saved.email || null };
  }

  @Put('me/child-profile')
  async updateChildProfile(
    @CurrentUser() user: User,
    @Body() body: { displayName?: string; age?: number; gender?: 'girl' | 'boy'; englishLevel?: 'A1' | 'A2' | 'B1' },
  ) {
    const profile = await this.usersService.saveChildProfile(user.userId, body || {});
    return {
      complete: true,
      displayName: profile.displayName,
      age: profile.age,
      gender: profile.gender,
      englishLevel: profile.englishLevel,
    };
  }

  @Patch('me/preferences')
  async updatePreferences(
    @CurrentUser() user: User,
    @Body() body: { interfaceLanguage?: 'russian' | 'english'; playbackRate?: number; readingTextSize?: 'small' | 'medium' | 'large' },
  ) {
    const preferences = await this.usersService.updatePreferences(user.userId, body || {});
    return {
      interfaceLanguage: preferences.interfaceLanguage,
      playbackRate: Number(preferences.playbackRate),
      readingTextSize: preferences.readingTextSize,
    };
  }

  @Get('me/progress')
  async getProgress(@CurrentUser() user: User) {
    try {
      return await this.seasonsService.getUserProgress(user.userId);
    } catch (error) {
      console.error('Get parent progress failed', error);
      throw new HttpException(error?.message || 'Get parent progress failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('me/home-summary')
  async getHomeSummary(@CurrentUser() user: User) {
    try {
      return await this.seasonsService.getHomeSummary(user.userId);
    } catch (error) {
      console.error('Get home summary failed', error);
      throw new HttpException(error?.message || 'Get home summary failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('me/learning-progress')
  async getLearningProgress(
    @CurrentUser() user: User,
    @Query('range') range?: string,
    @Query('seasonId') seasonId?: string,
  ) {
    try {
      return await this.seasonsService.getLearningProgress(user.userId, { range, seasonId });
    } catch (error) {
      console.error('Get learning progress failed', error);
      throw new HttpException(error?.message || 'Get learning progress failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('me/library')
  async getLibrary(@CurrentUser() user: User) {
    try {
      return await this.seasonsService.getLibrary(user.userId);
    } catch (error) {
      console.error('Get library failed', error);
      throw new HttpException(error?.message || 'Get library failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
