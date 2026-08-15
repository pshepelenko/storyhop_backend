import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ChatRequestDto } from './dto/create-chat.dto';
import { Finder } from 'src/finder';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/stories/entities/user.entity';
import { Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { openAIHandling } from 'src/openai-handling';

@Injectable()
export class ChatsService {
  private readonly openai: OpenAI;
  constructor(
      @InjectRepository(User)
      private usersRepository: Repository<User>,
      @InjectRepository(Client)
      private clientsRepository: Repository<Client>,
    ) {
      // Initialize OpenAI API client with the API key
      this.openai = new OpenAI({
        apiKey: process.env.CHATGPT_API_KEY,
      });
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

  async getChatResponse(chatRequest: ChatRequestDto) {
    const finder = new Finder(this.usersRepository, this.clientsRepository);
    const threadHandling = new openAIHandling(this.usersRepository);
    
    // Get user ID and assistandId
    let user = await finder.findUser(chatRequest.channelId, chatRequest.userId, chatRequest.userFullName, chatRequest.userTelegramAlias)
    const assistantId = await finder.findAssistant(chatRequest.chatBotId)
    
    // Get active thread ID
    let activeThread = user.activeThread;
    if (!activeThread) {
      // Create a new thread if not exists
      activeThread = await threadHandling.createThread(user.userId);
    }    

    // Send user message to the active thread
    if (chatRequest.systemMessage) await threadHandling.sendMessageToThread(activeThread, chatRequest.systemMessage);
    await threadHandling.sendMessageToThread(activeThread, chatRequest.message);

    // Run the thread
    const runStatus = await threadHandling.runThread(activeThread, assistantId);
    if (runStatus === 'completed') {
      const reply = await threadHandling.getLastMessage(activeThread)
      
      return { response: reply };
    } else {
      return { response: 'Ошибка, пожалуйста попробуйте еще раз'};
    }   
  }
}
