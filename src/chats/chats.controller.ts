import { Controller, Get, Post, Body } from '@nestjs/common';
import { ChatsService } from './chats.service.js';
import { ChatRequestDto } from './dto/create-chat.dto.js';
import { Biller } from 'src/billing';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/stories/entities/user.entity';
import { Repository } from 'typeorm';
import { channel } from 'diagnostics_channel';
import { Client } from './entities/client.entity.js';

@Controller('chats')
export class ChatsController {
  constructor(
    @InjectRepository(User)
      private usersRepository: Repository<User>,
    @InjectRepository(Client)
      private clientsRepository: Repository<Client>,
    private readonly chatService: ChatsService
  ) {}
  
  @Post('response')
  async getChatResponse(@Body() chatRequest: ChatRequestDto): Promise< string | { response: any }> {
    const biller = new Biller(this.usersRepository, this.clientsRepository);
    // Check subscription
    const hasSubscription = await biller.checkSubscription(chatRequest.channelId, chatRequest.userId, chatRequest.chatBotId, chatRequest.userFullName, chatRequest.userTelegramAlias);
    if (!hasSubscription) {
      return { response:'Ваш лимит сообщений исчерпан. Пожалуйта приобретите подписку в разделе Подписка в начальном меню.'};
    }

    // Decrease limit
    const billingCheck = await biller.decreaseLimit(chatRequest.channelId, chatRequest.userId, chatRequest.chatBotId);
    if (billingCheck) 
    {
      const reply = await this.chatService.getChatResponse(chatRequest);
      return reply;
    } else return { response: 'Ваш лимит сообщений исчерпан. Пожалуйта приобретите подписку в разделе Подписка в начальном меню.'}
  }

  @Post('/billing/update-subscription')
  async updateSubscription(@Body() body: { userId: string; channelId: string; chatbotId: string }): Promise<string> {
    const { userId, channelId, chatbotId } = body;
    const biller = new Biller(this.usersRepository, this.clientsRepository);
    const status = await biller.renewSubscription(channelId, userId, chatbotId)
    return status;
  }  
  
}
