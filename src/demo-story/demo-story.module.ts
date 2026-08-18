import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpenRouterModule } from '../openrouter/openrouter.module';
import { PixazoModule } from '../pixazo/pixazo.module';
import { StorageModule } from '../storage/storage.module';
import { AudioMetadataModule } from '../audio-metadata/audio-metadata.module';
import { DemoStoryController } from './demo-story.controller';
import { DemoStory } from './demo-story.entity';
import { DemoStoryNode } from './demo-story-node.entity';
import { DemoStoryService } from './demo-story.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DemoStory, DemoStoryNode]),
    OpenRouterModule,
    PixazoModule,
    StorageModule,
    AudioMetadataModule,
  ],
  controllers: [DemoStoryController],
  providers: [DemoStoryService],
})
export class DemoStoryModule {}
