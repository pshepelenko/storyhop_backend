import { Controller, Post, Get, Body, HttpException, HttpStatus, Param } from '@nestjs/common';
import { StoryService } from './stories.service';
import { Biller } from 'src/billing';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import { Client } from 'src/chats/entities/client.entity';
import { lang } from 'moment';

@Controller('stories')
export class StoryController {
  constructor(
      @InjectRepository(User)
        private usersRepository: Repository<User>,
      @InjectRepository(Client)
        private clientsRepository: Repository<Client>,
      private readonly storyService: StoryService
    ) {}
  
  

  @Post('start')
  async startStory(@Body() body: { channelUserId: string; channel: string, theme: string; age: string, comments: string, requestId: string, characterName: string, language: string }) {
    const { channelUserId, channel, theme, age, comments, requestId, characterName, language} = body;
    console.log('Processing start request number', requestId);
    const biller = new Biller(this.usersRepository, this.clientsRepository);
    // Check subscription
    const hasSubscription = await biller.checkSubscription(channel, channelUserId, 'storybot');
    if (!hasSubscription) {
      return { text: 'Ваш лимит исчерпан.'};
    }

    // Decrease limit
    const billingCheck = await biller.decreaseLimit(channel, channelUserId, 'storybot');
    if (billingCheck) 
    {
      if (!theme || !age) {
        throw new HttpException('Theme and violence level are required.', HttpStatus.BAD_REQUEST);
      }

      try {
        const { storyId, userId, storyText, audioUrl } = await this.storyService.startStory(channelUserId, channel, theme, age, comments, characterName, language);
        return { storyId: storyId, userId: userId, text: storyText, audioUrl: audioUrl};
      } catch (error) {
        throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    } else return { response: 'Ваш лимит исчерпан.'}
  }

  @Post('continue')
  async continueStory(@Body() body: { userId: string; channel:string, storyId:string; choice: string, requestId:string, language: string }) {
    const { userId, channel, storyId, choice, requestId, language } = body;

    console.log('Processing continue request number', requestId);
    const biller = new Biller(this.usersRepository, this.clientsRepository);
        // Check subscription
        const hasSubscription = await biller.checkSubscription(channel, userId, 'storybot');
        if (!hasSubscription) {
          return { text: 'Ваш лимит исчерпан.'};
        }
    
        // Decrease limit
        const billingCheck = await biller.decreaseLimit(channel, userId, 'storybot');
        if (billingCheck) 
        {
          if (!choice) {
            throw new HttpException('Choice is required.', HttpStatus.BAD_REQUEST);
          }
      
          try {
            const { storyText,  chapterContentAudios, lastChapterAudios } = await this.storyService.continueStory(userId, channel, storyId, choice, language);
            return { text: storyText, chapterContentAudios, lastChapterAudios };
          } catch (error) {
            throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
          }
        } else return { response: 'Ваш лимит исчерпан.'}
  }
  @Post('finish')
  async finishStory(@Body() body: { userId: string; channel:string}) {
    const { userId, channel} = body;

    try {
      const status  = await this.storyService.endStory(userId, channel);
      return { text: status };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('/users/:userId')
  async getStories(@Param('userId') userId: string) {
    try {
      const stories = await this.storyService.getStories(userId);
      return stories;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('/choices/users/:userId')
  async getChoices(@Param('userId') userId: string) {
    try {
      const choices = await this.storyService.getChoices(userId);
      return choices;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('/:storyId')
  async getStoryById(@Param('storyId') storyId: string) {
    try {
      const story = await this.storyService.getStoryById(storyId);
      return story;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('users/:userId/subscription')
  async getSubscriptionDetails(@Param('userId') userId: string) {
    const biller = new Biller(this.usersRepository, this.clientsRepository);
    // Check subscription
    const subscriptionDetails = await biller.getSubscriptionDetails('web-app', userId, 'storybot');
    return subscriptionDetails;
  }

  @Get('users/:userId/settings')
  async getUserSettings(@Param('userId') userId: string) {
    const userSettings = await this.storyService.getUserSettings(userId);
    return userSettings;
  }

  
  @Get('subchallenges/:challenge')
  async getSubChallenges(@Param('challenge') challenge: string) {
    const subChallenges = await this.storyService.getSubchallenges(challenge);
    return subChallenges;
  }

  @Post('users/:userId/settings')
  async saveUserSettings(@Body() body: { userId: string; channel:string; narratives: string[]; subchallenges: string[]; childName: string }) {
    const { userId, channel, narratives,  subchallenges, childName} = body;
    try {
      await this.storyService.saveSettings(userId, channel, narratives, subchallenges, childName);
      return true;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }





  @Post('/purchase')
  async purchaseStories(@Body() body: { userId: string; channel:string; plan: string }) {
    const { userId, channel, plan} = body;
    try {
      const redirectURL  = await this.storyService.initiatePayment(userId, channel, plan);
      return { url: redirectURL};
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('/webhook/youkassa')
  async handleWebhook(@Body() payload: any) {
    console.log('webhook payload:')
    console.log(payload)
    if (payload.event !== 'payment.succeeded') {
      throw new HttpException('Invalid event', HttpStatus.BAD_REQUEST);
    }

    const userId = payload.object.metadata?.user_id;
    const paymentId = payload.object.id;
    const amount = payload.object.amount.value;

    if (!userId) {
      throw new HttpException('User ID not found in metadata', HttpStatus.BAD_REQUEST);
    }

    await this.storyService.processSuccessfulPayment(userId, paymentId, amount, payload.object.id);
    
    return { status: 'success' };
  }
}
