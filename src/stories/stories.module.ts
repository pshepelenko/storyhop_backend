import { Module } from '@nestjs/common';
import { StoryService } from './stories.service';
import { StoryController } from './stories.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/stories/entities/user.entity';
import { Story } from './entities/story.entity';
import { Client } from 'src/chats/entities/client.entity';
import { Payment } from './entities/payment.entity';
import { Choice } from './entities/choise.etity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Story, Client, Payment, Choice])],
  controllers: [StoryController],
  providers: [StoryService]
})
export class StoriesModule {}
