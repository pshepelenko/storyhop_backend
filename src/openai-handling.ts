import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './stories/entities/user.entity';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { Client } from './chats/entities/client.entity';

export class openAIHandling {
  private readonly openai: OpenAI;
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {
     this.openai = new OpenAI({
        apiKey: process.env.CHATGPT_API_KEY,
      });
  }

  async createThread(userId:string): Promise<any> {
    
    const response = await this.openai.beta.threads.create();
    let threadId = response.id;
    // Updating a user record with a new thread
    let user = await this.usersRepository.findOne({ where: { userId: userId } });
    if (user) {
      user.threadsIDs.push(threadId);
      user.activeThread = threadId;
      await this.usersRepository.save(user);
    } else {
      throw new Error(`User with ID ${userId} not found`);
    }
    console.log(`Created new thread with ID: ${threadId} for user ${userId}`);
    
    return threadId;
  }
  async sendMessageToThread(threadId: string, query: string): Promise<any> {
    
    const response = await this.openai.beta.threads.messages.create( threadId, {
      role: "user", content: query, // User's query as input
    });
    console.log(response)
    return response;
  }
  async getLastMessage(threadId: string): Promise<any> {
    // Fetch the last message from the thread
    const threadMessages = await this.openai.beta.threads.messages.list(threadId);
    
    const lastMessage = threadMessages.data[0].content[0];

    if (!lastMessage) {
      throw new Error('Failed to fetch the last message');
    }

    // Check if the lastMessage has a text property
    if (lastMessage.type == 'text') {
      console.log('threadMessages.data', lastMessage.text.value);
      return lastMessage.text.value;
    } else {
      throw new Error('Last message does not contain text');
    }    
  }
  async runThread(threadId: string, assistantId: string): Promise<any> {
    
    //Run a thread
    const run = await this.openai.beta.threads.runs.create(
      threadId,
      { assistant_id: assistantId }
    );
    
    // Check the status of the run every 100 ms for 90 seconds
    let runStatus = run.status;
    const startTime = Date.now();
    while (runStatus !== 'completed' ) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const runStatusResponse = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
      runStatus = runStatusResponse.status;
    }
    console.log(`Run status: ${runStatus}`);
    // if (runStatus !== 'completed') {
    //   console.log('Run did not complete within 60 seconds');
    // throw new Error('Run did not complete within 60 seconds');
    // }
    return runStatus;
  }
}
