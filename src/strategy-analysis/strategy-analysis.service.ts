import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class StrategyAnalysisService {
  private readonly openai: OpenAI;
  private userThreadMap: Map<string, string> = new Map(); // Maps userId to threadId
  private  assistantId = process.env.CHATGPT_ASSISTANT_ID;
  constructor() {
    // Initialize OpenAI API client with the API key
    this.openai = new OpenAI({
      apiKey: process.env.CHATGPT_API_KEY,
    });
  }

  /**
   * Process the user's query and return the response from ChatGPT.
   * @param userId - The unique identifier for the user.
   * @param query - The user's query to be analyzed.
   * @returns ChatGPT's response to the query.
   */
  async processQuery(userId: string, query: string): Promise<any> {
    try {
      // Check if a thread already exists for the user
      let threadId = this.userThreadMap.get(userId);

      if (!threadId) {
        // Create a new thread if none exists
        const threadResponse = await this.createThread();
        threadId = threadResponse.id;
        this.userThreadMap.set(userId, threadId); // Save the threadId for the user
        console.log(`Created new thread with ID: ${threadId} for user ${userId}`);
      } else {
        console.log(`Using existing thread ID: ${threadId} for user ${userId}`);
      }

      
      
      // Send the query as a message in the thread
      const messageSent = await this.sendMessageToThread(threadId, query);
      
      //Run a thread
      const run = await this.openai.beta.threads.runs.create(
        threadId,
        { assistant_id: this.assistantId }
      );
      
      // Check the status of the run every 100 ms for 30 seconds
      let runStatus = run.status;
      const startTime = Date.now();
      while (runStatus !== 'completed' && Date.now() - startTime < 90000) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const runStatusResponse = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
        runStatus = runStatusResponse.status;
      }
      console.log(`Run status: ${runStatus}`);
      if (runStatus !== 'completed') {
        throw new Error('Run did not complete within 90 seconds');
      }

      // Fetch the last message from the thread
      const threadMessages = await this.openai.beta.threads.messages.list(threadId);
      const lastMessage = threadMessages.data[0].content;

      if (!lastMessage) {
        throw new Error('Failed to fetch the last message');
      }

      const reply = lastMessage;
      
      return reply;
    } catch (error: any) {
      console.error('Error communicating with ChatGPT Assistants API:', error.message);

      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }

      throw new Error('Failed to process query');
    }
  }

  /**
   * Create a new thread for communication with ChatGPT Assistants API.
   * @returns The thread creation response from the API.
   */
  private async createThread(): Promise<any> {
    
    if (!this.assistantId) {
      throw new Error('Assistant ID is missing in the .env file');
    }

    const response = await this.openai.beta.threads.create();
    console.log(response)
    return response;
  }

  /**
   * Send a message to the specified thread and get the response.
   * @param threadId - The ID of the thread where the message will be sent.
   * @param query - The user's query to send to ChatGPT.
   * @returns The response from ChatGPT.
   */
  private async sendMessageToThread(threadId: string, query: string): Promise<any> {
    
    if (!this.assistantId) {
      throw new Error('Assistant ID is missing in the .env file');
    }

    const response = await this.openai.beta.threads.messages.create( threadId, {
      role: "user", content: query, // User's query as input
    });
    console.log(response)
    return response;
  }
}
