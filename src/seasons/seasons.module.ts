import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeasonsController } from './seasons.controller';
import { SeasonsService } from './seasons.service';
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
import { BonusPracticeState } from './entities/bonus-practice-state.entity';
import { SeasonCharactersService } from './tti/season-characters.service';
import { TtiPromptService } from './tti/tti-prompt.service';
import { LearningEvent } from './entities/learning-event.entity';
import { ProgressController } from './progress.controller';
import { ChildProfile } from '../users/entities/child-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Season,
      SeasonFramework,
      Hero,
      Episode,
      EpisodeChoice,
      GenerationJob,
      CrystalWallet,
      CrystalLedgerEntry,
      Illustration,
      StorybookEntry,
      PreparedEpisode,
      SeasonCharacter,
      BonusPracticeState,
      LearningEvent,
      ChildProfile,
    ]),
  ],
  controllers: [SeasonsController, ProgressController],
  providers: [SeasonsService, SeasonCharactersService, TtiPromptService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
