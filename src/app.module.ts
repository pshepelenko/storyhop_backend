import { Module, OnModuleInit } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from './users/entities/user.entity';
import { AuthSession } from './users/entities/auth-session.entity';
import { ChildProfile } from './users/entities/child-profile.entity';
import { UserPreference } from './users/entities/user-preference.entity';
import { SeasonsModule } from './seasons/seasons.module';
import { Season } from './seasons/entities/season.entity';
import { SeasonFramework } from './seasons/entities/season-framework.entity';
import { Hero } from './seasons/entities/hero.entity';
import { Episode } from './seasons/entities/episode.entity';
import { GenerationJob } from './seasons/entities/generation-job.entity';
import { EpisodeChoice } from './seasons/entities/episode-choice.entity';
import { CrystalWallet } from './seasons/entities/crystal-wallet.entity';
import { CrystalLedgerEntry } from './seasons/entities/crystal-ledger.entity';
import { Illustration } from './seasons/entities/illustration.entity';
import { StorybookEntry } from './seasons/entities/storybook-entry.entity';
import { PreparedEpisode } from './seasons/entities/prepared-episode.entity';
import { SeasonCharacter } from './seasons/entities/season-character.entity';
import { OpenRouterModule } from './openrouter/openrouter.module';
import { PixazoModule } from './pixazo/pixazo.module';
import { StorageModule } from './storage/storage.module';
import { PromptsModule } from './prompts/prompts.module';
import { LoggingModule } from './logging/logging.module';
import { WorkerModule } from './worker/worker.module';
import { ReferralModule } from './referral/referral.module';
import { Referral } from './seasons/entities/referral.entity';
import { LearningEvent } from './seasons/entities/learning-event.entity';
import { BonusPracticeState } from './seasons/entities/bonus-practice-state.entity';
import { DemoStoryModule } from './demo-story/demo-story.module';
import { DemoStory } from './demo-story/demo-story.entity';
import { DemoStoryNode } from './demo-story/demo-story-node.entity';
import { runMigrations } from './migrations/migration-runner';
import { UsersModule } from './users/users.module';
import { AudioMetadataModule } from './audio-metadata/audio-metadata.module';

const env = (...keys: string[]) => keys.map((key) => process.env[key]).find(Boolean);
const envFlag = (...keys: string[]) => env(...keys) === 'true';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      ...(env('DATABASE_URL') ? { url: env('DATABASE_URL') } : {}),
      host: env('DB_HOST', 'DATABASE_HOST'),
      port: parseInt(env('DB_PORT', 'DATABASE_PORT') || '5432', 10),
      username: env('DB_USERNAME', 'DATABASE_USER'),
      password: env('DB_PASSWORD', 'DATABASE_PASSWORD'),
      database: env('DB_NAME', 'DATABASE_NAME') || 'postgres',
      entities: [
        User, AuthSession, ChildProfile, UserPreference,
        Season, SeasonFramework, Hero, Episode, EpisodeChoice,
        GenerationJob, CrystalWallet, CrystalLedgerEntry,
        Illustration, StorybookEntry, PreparedEpisode, Referral, SeasonCharacter, LearningEvent, BonusPracticeState,
        DemoStory, DemoStoryNode,
      ],
      synchronize: envFlag('DB_SYNCHRONIZE', 'DATABASE_SYNCHRONIZE'),
      logging: false,
      ssl: envFlag('DB_SSL', 'DATABASE_SSL') ? { rejectUnauthorized: false } : false,
    }),
    OpenRouterModule,
    PixazoModule,
    StorageModule,
    PromptsModule,
    LoggingModule,
    UsersModule,
    AudioMetadataModule,
    SeasonsModule,
    WorkerModule,
    ReferralModule,
    DemoStoryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit() {
    try {
      await runMigrations(this.dataSource);
    } catch (error) {
      console.error('[Migrations] Failed to run migrations:', error?.message || error);
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
    }
  }
}
