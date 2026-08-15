import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import OpenAI from 'openai';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/stories/entities/user.entity';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { Story } from './entities/story.entity';
import { Finder } from '../finder';
import { Client } from 'src/chats/entities/client.entity';
import { Payment } from './entities/payment.entity';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import { Choice } from './entities/choise.etity';
import { randomInt } from 'crypto';

@Injectable()
export class StoryService {
  private readonly openai: OpenAI;
  private readonly openRouterChatModel = process.env.OPENROUTER_STORY_MODEL || 'deepseek/deepseek-v4-flash';
  private readonly openRouterTtsModel = process.env.OPENROUTER_TTS_MODEL || 'hexgrad/kokoro-82m';
  private readonly openRouterTtsVoice = process.env.OPENROUTER_TTS_VOICE || 'af_heart';
  private readonly openRouterImageModel = process.env.OPENROUTER_IMAGE_MODEL || 'black-forest-labs/flux.2-klein-4b';
  private storytellerAssistantRusId = process.env.CHATGPT_ASSISTANT_STORYTELLER_RUSSIAN_ID;
  private storytellerAssistantEngId = process.env.CHATGPT_ASSISTANT_STORYTELLER_ENGLISH_ID;
  private challengeSplitterAssistantId = process.env.CHATGPT_ASSISTANT_CHALLENGE_SPLITTER_ID;
  private storage?: S3Client;
  
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Story)
    private storiesRepository: Repository<Story>,
    @InjectRepository(Client)
    private clientsRepository: Repository<Client>,
    @InjectRepository(Payment)
    private paymentsRepository: Repository<Payment>,
    @InjectRepository(Choice)
    private choicesRepository: Repository<Choice>
  ) {
    // Initialize OpenAI API client with the API key
    this.openai = new OpenAI({
      apiKey: process.env.CHATGPT_API_KEY,
    });
    
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  /**
   * Process the user's query and return the response from ChatGPT.
   * @param userId - The unique identifier for the user.
   * @param query - The user's query to be analyzed.
   * @returns ChatGPT's response to the query.
   */
  
  async getStories(userId: string): Promise<{ storyId: string, title: string, coverURL: string }[]> {
    const user = await this.usersRepository.findOne({ where: { userId } });

    

    let stories = [];
    try {
      stories = await this.storiesRepository.find({ where: { userId: user.userId }, order: { updatedAt: 'DESC' } });
    } catch (err) {
      return [];
    }

    if (stories.length == 0) return [];

    return stories.map(story => ({
      storyId: story.storyId,
      title: story.title,
      coverURL: story.coverURL,
    }));
  }

  async getStoryById(storyId: string): Promise<any> {
    // Fetch the story from the database
    const story = await this.storiesRepository.findOne({ where: { storyId } });
    if (!story) {
      throw new HttpException('Story not found', HttpStatus.NOT_FOUND);
    }

    // Extract audio URLs for 'chapter content'
    const chapterContentAudios = story.audioURLs
      .filter(audio => audio.type === 'chapter content')
      .map(audio => audio.URL);

    // Extract 'intro options phrase' and 'answer option' audios for the last chapter
    const lastChapterId = `${story.storyId}-${story.chapterNumber}`;
    const lastChapterAudios = story.audioURLs.filter(
      audio => audio.chapterId === lastChapterId && (audio.type === 'intro options phrase' || audio.type === 'answer option')
    );

    // Prepare the output
    const output = {
      storyId: story.storyId,
      userId: story.userId,
      title: story.title,
      lastQuestion: story.lastQuestion,
      chapterContentAudios: chapterContentAudios,
      lastChapterAudios: lastChapterAudios,
    };

    return output;
  }
  
  async startStory(channelUserId: string, channel: string, theme: string, age: string, comments: string, characterName: string, language = 'russian'): Promise<any> {
    // Check if user exists in the database for the given channel
    let finder = new Finder(this.usersRepository, this.clientsRepository);
    let user = await finder.findUser(channel, channelUserId);

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Merge the narratives array into a single string separated by commas
    const narrativesString = user.narratives ? user.narratives.join(', ') : '';

    // Keep a local thread id for story continuity without depending on Assistants API.
    let threadId = uuidv4();
    user.activeThread = threadId;
    user.threadsIDs.push(threadId);
    await this.usersRepository.save(user);
    let charactersNames = user.childName;
    if (characterName && characterName !== '') {
      charactersNames = characterName;
    }
    
    if (!charactersNames || charactersNames === '') {
      charactersNames = 'на твое усмотрение';
    }
    
    let subchallenge = 'пользователь не указал сложность';
    if (user.subchallenges && user.subchallenges.length > 0) subchallenge = user.subchallenges[randomInt(0, user.subchallenges.length)];
    
    // Sending initial message to the thread
    let query = ''
    language == 'russian' ? 
      query = `Начинаем новую историю в этом треде. Тема истории ${theme}. Главного героя (или главных героев) зовут ${charactersNames}. Дополнительные комментарии: ${comments}. Родитель хочет, чтобы история мягко передавала следующие идеи: ${narrativesString}. Сказка должна помочь ребенку справиться со следующей сложностью: ${subchallenge}. Начни историю и предложи 3 варианта ответов. Придумай и напиши в первой строке название историии без каких-либо служебных знаков типа * или #. Текст истории и заголовок должны быть на русском языке за исключением текста внутри [], используй "ё" вместо "е" где это необходимо по смыслу.`
      :
      query = `Starting a new story in this thread. The theme of a story is ${theme}. The name of a main charachter (or characters) is  ${charactersNames}. Additional comments: ${comments}. A parent wants the story to gently promote these ideas: ${narrativesString}. The story should help a child to tackle this issue: ${subchallenge}. Start a story and propose 3 answer options. Create a title of the story and write it in the first line without any additional signs, such as * or #.`;
    
    const reply = await this.generateStoryCompletion(query, language);

    if (reply) {
      const storyId = uuidv4();

      // Split the reply into parts
      const [chapterContent, optionsBlock = ''] = reply.split('-x-');
      const [introPhrase, ...options] = optionsBlock.split('\n').filter(line => line.trim() !== '');
      if (!chapterContent || !introPhrase || options.length === 0) {
        throw new Error('Story model response is missing the required -x- options block');
      }

      // Remove the story title (first line) from chapterContent
      const cleanedChapterContent = chapterContent.split('\n').slice(1).join('\n').trim();

      // Generate audio for each part
      const audioURLs = [];
      audioURLs.push({ 
        chapterId: storyId + '-1', 
        type: 'chapter content', 
        URL: language == 'russian' ? await this.generateAudioFromText(cleanedChapterContent, `${storyId}-chapter`) : await this.generateAudioFromTextEng(cleanedChapterContent, `${storyId}-chapter`)
      });
      audioURLs.push({ 
        chapterId: storyId + '-1', 
        type: 'intro options phrase',
        URL: language == 'russian' ? await this.generateAudioFromText(introPhrase.trim(), `${storyId}-intro`) : await this.generateAudioFromTextEng(introPhrase.trim(), `${storyId}-intro`)
      });

      for (let i = 0; i < options.length; i++) {
        const option = options[i].replace(/\[.*?\]/g, '').trim();
        audioURLs.push({ 
          chapterId: storyId + '-1', 
          type: 'answer option',
          URL: language == 'russian' ?  await this.generateAudioFromText(option, `${storyId}-option${i + 1}`) : await this.generateAudioFromTextEng(option, `${storyId}-option${i + 1}`)
        });
      }

      // Extract the title from the first line of the reply
      const title = reply.split('\n')[0];

      // Get the cover URL based on the theme
      const coverURL = this.getCoverURL(theme);

      // Save story information into the 'stories' table
      const story = this.storiesRepository.create({
        storyId: storyId,
        userId: user.userId,
        world: theme,
        age: age,
        comments: comments,
        threadId: threadId,
        coverURL: coverURL,
        title: title,
        lastQuestion: await this.getOptionsText(reply),
        audioURLs: audioURLs,
        text: await this.getChapterText(reply),
        createdAt: new Date(),
        updatedAt: new Date(),
        language: language,
        chapterNumber: 1,
      });
      await this.storiesRepository.save(story);

      // Updating user record
      user.lastActiveAt = new Date();
      await this.usersRepository.save(user);

      return { storyId: storyId, userId: user.userId, storyText: await this.getOptionsText(reply), audioUrls: audioURLs };
    } else {
      return 'Ошибка, пожалуйста попробуйте еще раз';
    }
  }

  async continueStory(userId: string, channel: string, storyId: string, choice: string, language = 'russian'): Promise<any> {
    let finder = new Finder(this.usersRepository, this.clientsRepository);
    let user = await finder.findUser(channel, userId);

    // Fetching story information for the given storyId
    const story = await this.storiesRepository.findOne({ where: { storyId } });
    if (!story) {
      return 'Ошибка, не найдена история';
    }
    const storyLanguage = story.language || language;

    // Extract the Decision Type for the given choice
    const decisionType = this.getDecisionTypeForChoice(story.lastQuestion, choice);
    console.log(`Decision Type for choice "${choice}": ${decisionType}`);

    if (!decisionType) {
      return 'Ошибка, не найден тип решения для выбранного варианта';
    }

    // Save the choice in the choices table
    const choiceRecord = this.choicesRepository.create({
      id: uuidv4(),
      storyId: story.storyId,
      userId: user.userId,
      chapterId: story.audioURLs.length.toString(),
      choiceText: choice,
      decisionType: decisionType,
      timeStamp: new Date()
    });
    await this.choicesRepository.save(choiceRecord);

    // Fetching threadId for the user
    let threadId = story.threadId;
    if (!threadId) {
      return 'Ошибка, не найдена активная история для пользователя';
    }

    const query = this.buildContinueStoryPrompt(story, choice, storyLanguage);
    console.log(`Generating next story chapter for choice "${choice}".`);
    const reply = await this.generateStoryCompletion(query, storyLanguage);

    if (reply) {

      // Split the reply into parts
      const [chapterContent, optionsBlock = ''] = reply.split('-x-') || [reply, ''];

      // Generate audio for chapter content
      const audioURLs = [];
      const newChapterNumber = story.chapterNumber + 1;
      const newChapterId = storyId + '-' + newChapterNumber;
      audioURLs.push({
        chapterId: newChapterId,
        type: 'chapter content',
        URL: storyLanguage == 'russian' ? await this.generateAudioFromText(chapterContent.trim(), `${storyId}-chapter-${Date.now()}`) : await this.generateAudioFromTextEng(chapterContent.trim(), `${storyId}-chapter-${Date.now()}`),
      });

      if (optionsBlock) {
        const [introPhrase, ...options] = optionsBlock.split('\n').filter(line => line.trim() !== '');
        if (!introPhrase || options.length === 0) {
          throw new Error('Story model response is missing the required answer options');
        }

        // Generate audio for intro options phrase
        audioURLs.push({
          chapterId: newChapterId,
          type: 'intro options phrase',
          URL: storyLanguage == 'russian' ? await this.generateAudioFromText(introPhrase.trim(), `${storyId}-intro-${Date.now()}`) : await this.generateAudioFromTextEng(introPhrase.trim(), `${storyId}-intro-${Date.now()}`),
        });

        // Generate audio for each answer option
        for (let i = 0; i < options.length; i++) {
          const option = options[i].replace(/\[.*?\]/g, '').trim();
          audioURLs.push({
            chapterId: newChapterId,
            type: 'answer option',
            URL: storyLanguage == 'russian' ? await this.generateAudioFromText(option, `${storyId}-option${i + 1}-${Date.now()}`) : await this.generateAudioFromTextEng(option, `${storyId}-option${i + 1}-${Date.now()}`),
          });
        }
      }

      // Update the story record in the database
      story.lastQuestion = await this.getOptionsText(reply);
      story.audioURLs.push(...audioURLs);
      story.text += '\n' + this.getChapterText(reply);
      story.updatedAt = new Date();
      story.chapterNumber += 1;
      await this.storiesRepository.save(story);

      // Extract chapter content audios
      const chapterContentAudios = story.audioURLs
        .filter(audio => audio.type === 'chapter content')
        .map(audio => audio.URL);

      // Extract last chapter audios
      const lastChapterAudios = story.audioURLs.filter(
        audio =>
          audio.chapterId === newChapterId &&
          (audio.type === 'intro options phrase' || audio.type === 'answer option'),
      );

      // Updating user record
      user.lastActiveAt = new Date();
      await this.usersRepository.save(user);

      return {
        storyText: await this.getOptionsText(reply),
        chapterContentAudios: chapterContentAudios,
        lastChapterAudios: lastChapterAudios,
      };
    } else {
      return 'Ошибка, пожалуйста попробуйте еще раз';
    }
  }

  async endStory(userId: string, channel: string): Promise<string> {
    let user = await this.usersRepository.createQueryBuilder("user")
      .where("user.channels @> :channel", { channel: JSON.stringify([{ channelName: channel, channelId: userId }]) })
      .getOne();

    if (!user) {
      return 'Ошибка, не найден пользователь';
    }

    // Fetching threadId for the user
    let threadId = user.activeThread;
    if (!threadId) {
      return 'Ошибка, не найдена активная история для пользователя';
    }

    // Clearing active thread for a user
    user.activeThread = null;
    await this.usersRepository.save(user);
    return 'История завершена.';
  }

  
  async initiatePayment(userId: string, channel: string, plan: string): Promise<string> {
    const shopId = process.env.PAYMENT_SHOPID_RUS; // Replace with your shop ID
    const secretKey = process.env.PAYMENT_API_KEY_RUS; // Replace with your secret key
    const idempotenceKey = uuidv4(); // Generate a unique idempotence key
    const amount = plan === '200 stories' ? '1500.00' : '1500.00'; // Example pricing logic
    const returnUrl = 'http://localhost:3001/subscription'; // Replace with your return URL
  
    const paymentData = {
      amount: {
        value: amount,
        currency: 'RUB',
      },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: returnUrl,
      },
      description: `Увелиение лимита историй на 200 штук`,
      metadata: {
        user_id: userId
      },
    };
  
    try {
      const response = await axios.post('https://api.yookassa.ru/v3/payments', paymentData, {
        headers: {
          'Idempotence-Key': idempotenceKey,
          'Content-Type': 'application/json',
        },
        auth: {
          username: shopId,
          password: secretKey,
        },
      });
  
      // Extract the redirect URL from the response
      const redirectUrl = response.data.confirmation.confirmation_url;
  
      // Return the redirect URL to the user
      return redirectUrl;
    } catch (error) {
      console.error('Error initiating payment:', error.response?.data || error.message);
      throw new HttpException('Failed to initiate payment', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async processSuccessfulPayment(userId: string, paymentId: string, amount: number, webhookId: string): Promise<boolean> {
    console.log(`Processing payment ${paymentId} for user ${userId}, amount: ${amount} руб.`);

    // Check if the paymentId already exists in the payments table
    const existingPayment = await this.paymentsRepository.createQueryBuilder('payment')
      .where('payment.webhookId = :webhookId', { webhookId })
      .getOne();

    if (existingPayment) {
      console.log(`Payment ${paymentId} has already been processed.`);
      return false; // Do not process the payment again
    }

    // Fetch the user from the database
    const user = await this.usersRepository.findOne({ where: { userId } });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Find the subscription for the storybot
    const subscription = user.subscriptions.find(sub => sub.chatbotId === 'storybot');

    if (!subscription) {
      throw new HttpException('Storybot subscription not found for the user', HttpStatus.NOT_FOUND);
    }

    // Add 200 to the limit
    subscription.limit += 200;

    // Save the updated user record
    await this.usersRepository.save(user);

    console.log(`Updated subscription limit for user ${userId}. New limit: ${subscription.limit}`);

    // Save the payment record to the payments table
    const paymentRecord = this.paymentsRepository.create({
      id: uuidv4(),
      webhookId: webhookId,
      userId: user.userId,
      amount: amount,
      date: new Date(),
      status: 'success'
    });
    await this.paymentsRepository.save(paymentRecord);

    return true;
  }

  /**
   * Generate audio from text using OpenAI TTS service and upload to S3.
   * @param text - The text to be converted to audio.
   * @returns The URL of the generated audio.
   */
  
  private async findUser(userId: string, channel: string) {
    let user = await this.usersRepository.createQueryBuilder("user")
      .where("user.channels @> :channel", { channel: JSON.stringify([{ channelName: channel, channelId: userId }]) })
      .getOne();    
    
    return user;
  }

  private async getOptionsText(text: string): Promise<string> {
    // Remove SSML tags using a regular expression
    let cleanedText = text.replace(/<[^>]+>/g, ''); // Matches and removes all tags like <tag>
    
    // Remove ' and * symbols, including text surrounded by *
    cleanedText = cleanedText.replace(/\*/g, ''); // Remove all * symbols
    cleanedText = cleanedText.replace(/'/g, ''); // Remove all ' symbols

    // Split the text and return the options part
    const textArray = cleanedText.split('-x-');
    return textArray[1] || ''; // Return the options part or an empty string if not found
  }

  private async getChapterText(text: string) {
    let textArray = text.split('-x-');
    return textArray[0];
  }

  private getOpenRouterApiKey(): string {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY or OPEN_ROUTER_API_KEY is missing in the environment variables');
    }

    return apiKey;
  }

  private createStorageClient(): S3Client {
    const r2Url = this.getCloudflareS3ApiUrl();
    const accountId = this.getEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID') || this.getR2AccountIdFromUrl(r2Url);
    const endpoint = this.getEnv('R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT') || (r2Url ? r2Url.origin : undefined) || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    const urlCredentials = this.getR2CredentialsFromUrl(r2Url);
    const accessKeyId = this.getEnv('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_ACCESS_KEY_ID') || urlCredentials?.accessKeyId;
    const secretAccessKey = this.getEnv('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_SECRET_ACCESS_KEY') || urlCredentials?.secretAccessKey;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error('Cloudflare R2 storage is not configured. Required: CLOUDFLARE_S3_API plus R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY, or separate R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY.');
    }

    return new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  private async uploadToStorage(key: string, body: Buffer, contentType: string): Promise<string> {
    const bucket = this.getStorageBucket();
    const storage = this.storage || (this.storage = this.createStorageClient());
    await storage.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));

    return this.getPublicStorageUrl(key, bucket);
  }

  private getStorageBucket(): string {
    const bucket = this.getEnv('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET') || this.getR2BucketFromUrl(this.getCloudflareS3ApiUrl());
    if (!bucket) {
      throw new Error('Cloudflare R2 bucket is not configured. Required: R2_BUCKET, CLOUDFLARE_R2_BUCKET, or a bucket path in CLOUDFLARE_S3_API.');
    }

    return bucket;
  }

  private getPublicStorageUrl(key: string, bucket: string): string {
    const publicUrl = this.getEnv('R2_PUBLIC_URL', 'CLOUDFLARE_R2_PUBLIC_URL');
    if (publicUrl) {
      return `${publicUrl.replace(/\/$/, '')}/${key}`;
    }

    const r2Url = this.getCloudflareS3ApiUrl();
    const accountId = this.getEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID') || this.getR2AccountIdFromUrl(r2Url);
    if (!accountId && !r2Url) {
      throw new Error('Cloudflare R2 public URL is not configured. Required: R2_PUBLIC_URL, CLOUDFLARE_R2_PUBLIC_URL, or CLOUDFLARE_S3_API.');
    }

    if (r2Url) {
      return `${r2Url.origin}/${bucket}/${key}`;
    }

    return `https://${bucket}.${accountId}.r2.cloudflarestorage.com/${key}`;
  }

  private getEnv(...keys: string[]): string | undefined {
    return keys.map((key) => process.env[key]).find(Boolean);
  }

  private getCloudflareS3ApiUrl(): URL | undefined {
    const rawUrl = this.getEnv('CLOUDFLARE_S3_API');
    if (!rawUrl) {
      return undefined;
    }

    try {
      return new URL(rawUrl);
    } catch {
      throw new Error('CLOUDFLARE_S3_API must be a valid URL.');
    }
  }

  private getR2AccountIdFromUrl(url?: URL): string | undefined {
    return url?.hostname.match(/^([^.]+)\.r2\.cloudflarestorage\.com$/)?.[1];
  }

  private getR2BucketFromUrl(url?: URL): string | undefined {
    return url?.pathname.split('/').filter(Boolean)[0];
  }

  private getR2CredentialsFromUrl(url?: URL): { accessKeyId: string; secretAccessKey: string } | undefined {
    if (!url?.username || !url?.password) {
      return undefined;
    }

    return {
      accessKeyId: decodeURIComponent(url.username),
      secretAccessKey: decodeURIComponent(url.password),
    };
  }

  private async generateStoryCompletion(prompt: string, language: string): Promise<string> {
    const apiKey = this.getOpenRouterApiKey();
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: this.openRouterChatModel,
        messages: [
          {
            role: 'system',
            content: this.getStorySystemPrompt(language),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.8,
        max_tokens: 1800,
        reasoning: {
          enabled: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3001',
          'X-Title': 'StoryHop',
        },
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => part?.text || part?.content || '')
        .join('')
        .trim();
    }

    throw new Error('OpenRouter story generation returned an empty response');
  }

  private async generateImageFromPrompt(prompt: string, imageName = ''): Promise<string> {
    const apiKey = this.getOpenRouterApiKey();
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: this.openRouterImageModel,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        modalities: ['image'],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3001',
          'X-Title': 'StoryHop',
        },
      },
    );

    const imageUrl = this.extractOpenRouterImageUrl(response.data);
    const imageBuffer = await this.loadImageBuffer(imageUrl);
    const key = imageName || Date.now().toString();
    return this.uploadToStorage(`images/generated/${key}.png`, imageBuffer, 'image/png');
  }

  private extractOpenRouterImageUrl(data: any): string {
    const message = data?.choices?.[0]?.message;
    const directUrl = message?.images?.[0]?.image_url?.url || message?.image_url?.url;
    if (directUrl) {
      return directUrl;
    }

    const content = Array.isArray(message?.content) ? message.content : [];
    const imagePart = content.find((part) => part?.image_url?.url || part?.url || part?.type === 'image_url');
    const imageUrl = imagePart?.image_url?.url || imagePart?.url;
    if (!imageUrl) {
      throw new Error('OpenRouter image generation returned an empty response');
    }

    return imageUrl;
  }

  private async loadImageBuffer(imageUrl: string): Promise<Buffer> {
    const dataUrlMatch = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      return Buffer.from(dataUrlMatch[2], 'base64');
    }

    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  }

  private getStorySystemPrompt(language: string): string {
    const formatInstruction =
      'Return only the story text. Do not include thinking, reasoning, analysis, markdown fences, or explanations. The response must contain the chapter text, then a line with exactly -x-, then an intro phrase and exactly 3 answer options. Add a decision type tag to each option in this format: [Decision Type: Creativity].';

    if (language === 'english') {
      return `${formatInstruction} Write in warm, age-appropriate English for a child. The first line must be a plain story title.`;
    }

    return `${formatInstruction} Write in warm, age-appropriate Russian for a child. The first line must be a plain story title.`;
  }

  private buildContinueStoryPrompt(story: Story, choice: string, language: string): string {
    if (language === 'english') {
      return `Continue this interactive child-friendly story.

Title: ${story.title}
Previous story text:
${story.text}

Previous options:
${story.lastQuestion}

The user chose: ${choice}

Continue the story from that choice and propose exactly 3 new answer options.`;
    }

    return `Продолжи эту интерактивную детскую сказку.

Название: ${story.title}
Предыдущий текст:
${story.text}

Предыдущие варианты:
${story.lastQuestion}

Пользователь выбрал: ${choice}

Продолжи историю с учетом этого выбора и предложи ровно 3 новых варианта ответа.`;
  }

  private async generateAudioFromTextEng(text: string, audioName = ''): Promise<string> {
    const apiKey = this.getOpenRouterApiKey();
    const cleanedText = text.replace(/\n|-x-/g, '').trim();
    if (!audioName) {
      audioName = Date.now().toString();
    }

    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/audio/speech',
        {
          input: cleanedText,
          model: this.openRouterTtsModel,
          voice: this.openRouterTtsVoice,
          response_format: 'mp3',
          speed: 1,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        }
      );

      return this.uploadToStorage(`audio/${audioName}.mp3`, Buffer.from(response.data), 'audio/mpeg');
    } catch (error) {
      console.error('Error generating audio with OpenRouter TTS:', error.response?.data || error.message);
      throw new Error('Failed to generate audio');
    }
  }

  private async generateAudioFromText(text: string, audioName = ''): Promise<string> {
    let cleanedText = text.replace(/\n|-x-/g, '').replace(/<voice mode="curious">/g, '<voice mode="happy">');
    console.log('text for TTS', Buffer.from(cleanedText).toString('utf-8'));
    if (audioName == '') audioName = Date.now().toString();
    
    try {
      // 1. Получаем OAuth-токен
      console.log('creating an accessToken request');
      const authResponse = await axios.post(
        'https://ngw.devices.sberbank.ru:9443/api/v2/oauth', 
        {
          scope: 'SALUTE_SPEECH_PERS',
          grant_type: 'client_credentials'
        }, 
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'RqUID': '9995ee0a-981c-41e1-8a99-efd7cad58cdd',
            'Authorization': `Basic ${process.env.SALUTE_AUTH_KEY}` // Здесь передаём API-ключ
          }
        }
      );

      const accessToken = authResponse.data.access_token;
      let config = {
        method: 'post',
        maxBodyLength: Infinity,
        responseType: 'arraybuffer' as const,
        url: 'https://smartspeech.sber.ru/rest/v1/text:synthesize?format=wav16&voice=Bys_24000',
        headers: { 
          'Content-Type': 'application/ssml', 
          // 'Accept': 'audio/x-wav', 
          'Authorization': `Bearer ${accessToken}`,
        },
        data: cleanedText
      };
      
      const timestamp1 = Date.now();
      const response = await axios.request(config);
      const timestamp2 = Date.now();
      console.log('Audio was successfully generated! Time:', timestamp2 - timestamp1, 'ms');

      const wavBuffer = Buffer.from(response.data);
      
      
      return this.uploadToStorage(`audio/${audioName}.mp3`, wavBuffer, 'audio/mpeg');

    } catch (error) {
      console.error('TTS error:', error.response ? error.response.data : error.message);
    }
  }

  private async getLastMessage(threadId: string): Promise<any> {
    // Fetch the last message from the thread
    const threadMessages = await this.openai.beta.threads.messages.list(threadId);
    
    const lastMessage = threadMessages.data[0].content[0];

    if (!lastMessage) {
      throw new Error('Failed to fetch the last message');
    }

    // Check if the lastMessage has a text property
    if (lastMessage.type == 'text') {
      console.log('threadMessages.data', Buffer.from(lastMessage.text.value).toString('utf8'));
      return lastMessage.text.value;
    } else {
      throw new Error('Last message does not contain text');
    }    
  }

  private async runThread(threadId: string, assistantId: string): Promise<any> {
    // Run a thread
    const run = await this.openai.beta.threads.runs.create(
      threadId,
      { assistant_id: assistantId }
    );
    
    // Check the status of the run every 100 ms for 30 seconds
    let runStatus = run.status;
    const startTime = Date.now();
    while (runStatus !== 'completed' && Date.now() - startTime < 60000) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const runStatusResponse = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
      runStatus = runStatusResponse.status;
    }
    console.log(`Run status: ${runStatus}`);
    if (runStatus === 'failed') {
      let run_status = await this.openai.beta.threads.runs.retrieve(threadId, run.id)
      console.log(run_status);
    }
    console.log(`Run processing time: ${(Date.now() - startTime)/1000} seconds`);

    if (runStatus !== 'completed') {
      throw new Error('Run did not complete within 60 seconds');
    }
    return runStatus;
  }

  private async createThread(userId: string): Promise<any> {
    const response = await this.openai.beta.threads.create();
    let threadId = response.id;
    // Updating a user record with a new thread
    let user = await this.usersRepository.findOne({ where: { userId: userId } });
    if (user) {
      user.threadsIDs.push(threadId);
      await this.usersRepository.save(user);
    } else {
      throw new Error(`User with ID ${userId} not found`);
    }
    console.log(`Created new thread with ID: ${threadId} for user ${userId}`);
    
    return response;
  }

  /**
   * Send a message to the specified thread and get the response.
   * @param threadId - The ID of the thread where the message will be sent.
   * @param query - The user's query to send to ChatGPT.
   * @returns The response from ChatGPT.
   */
  private async sendMessageToThread(threadId: string, query: string): Promise<any> {
    
    const response = await this.openai.beta.threads.messages.create(threadId, {
      role: "user", content: query, // User's query as input
    });
    console.log('sending message to thread',response);
    console.log('added message', Buffer.from(query).toString('utf-8'))
    return response;
  }

  private getCoverURL(theme: string): string {
    let coverKey = 'magic'; // default

    if (
      theme.includes('Фэнтезийный мир') ||
      theme.toLowerCase().includes('fantasy world')
    ) {
      coverKey = 'magic';
    } else if (
      theme.includes('Футуристический мир') ||
      theme.toLowerCase().includes('futuristic world')
    ) {
      coverKey = 'future';
    } else if (
      theme.includes('Пиратский мир') ||
      theme.toLowerCase().includes('pirate world')
    ) {
      coverKey = 'pirates';
    }

    const randomNumber = Math.floor(Math.random() * 4) + 1;
    const coversBaseUrl = this.getEnv('R2_COVERS_PUBLIC_URL', 'CLOUDFLARE_R2_COVERS_PUBLIC_URL', 'COVERS_PUBLIC_URL');
    if (coversBaseUrl) {
      return `${coversBaseUrl.replace(/\/$/, '')}/${coverKey}-${randomNumber}.jpeg`;
    }

    return `/covers/${coverKey}-${randomNumber}.jpeg`;
  }

  /**
   * Extracts the Decision Type for a given choice from the lastQuestion text.
   * @param lastQuestion - The text containing the options and Decision Types.
   * @param choice - The user's selected choice (e.g., "Вариант 1").
   * @returns The Decision Type for the given choice, or 'Creativity' if no number is found.
   */
  private getDecisionTypeForChoice(lastQuestion: string, choice: string): string {
    // Create a regex to find the relevant option containing the choice text and extract the Decision Type
    const optionRegex = new RegExp(`${choice}.*?\\[Decision Type: (.*?)\\]`, 's');
    const match = lastQuestion.match(optionRegex);
    if (!match) {
      console.error(`No match found for choice "${choice}" in lastQuestion.`);
    }
    // Return the Decision Type if found, otherwise return 'Creativity'
    return match ? match[1] : 'Creativity';
  }

  async getChoices(userId: string): Promise<{ [decisionType: string]: number }> {
    try {
      // Fetch choices for the given userId from the choicesRepository
      const choices = await this.choicesRepository.find({ where: { userId } });

      // Calculate the frequency of each decisionType
      const frequency: { [decisionType: string]: number } = {};
      choices.forEach(choice => {
        const decisionType = choice.decisionType;
        frequency[decisionType] = (frequency[decisionType] || 0) + 1;
      });

      // Return the frequency object
      return frequency;
    } catch (error) {
      console.error(`Error fetching choices for userId ${userId}:`, error.message);
      throw new HttpException('Failed to fetch choices', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getUserSettings(userId: string): Promise<any> {
    try {
      // Fetch the user from the database
      let finder = new Finder(this.usersRepository, this.clientsRepository);
      let user = await finder.findUser('web-app', userId);
      
      // Return the narratives array or an empty array if narratives are not defined
      return { narratives: user.narratives || [], subchallenges: user.subchallenges || [], childName: user.childName || '', userId: user.userId };
    } catch (error) {
      console.error(`Error fetching narratives for userId ${userId}:`, error.message);
      throw new HttpException('Failed to fetch narratives', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  
  async saveSettings(userId: string, channel: string, narratives: string[], subChallenges: string[], childName: string): Promise<string> {
    try {
      // Fetch the user from the database
      let finder = new Finder(this.usersRepository, this.clientsRepository);
      let user = await finder.findUser(channel, userId);

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // Save the narratives to the user's record
      user.subchallenges = subChallenges;
      user.childName = childName;
      user.narratives = narratives;
      await this.usersRepository.save(user);

      return 'Narratives saved successfully';
    } catch (error) {
      console.error(`Error saving narratives for userId ${userId}:`, error.message);
      throw new HttpException('Failed to save narratives', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getSubchallenges(challengeDescription: string): Promise<string[]> {
    if (!this.challengeSplitterAssistantId) {
      throw new Error('Assistant ID for challenge splitter is missing in the environment variables');
    }

    try {
      const threadResponse = await this.createThread('challenge-splitter');
      const threadId = threadResponse.id;

      const query = `${challengeDescription}`;
      await this.sendMessageToThread(threadId, query);

      const runStatus = await this.runThread(threadId, this.challengeSplitterAssistantId);

      if (runStatus === 'completed') {
        const reply = await this.getLastMessage(threadId);
        const subchallenges = reply.split('\n').map(line => line.trim()).filter(line => line !== '');
        return subchallenges;
      } else {
        throw new Error('Failed to process the challenge splitting request');
      }
    } catch (error) {
      console.error('Error fetching subchallenges:', error.message);
      throw new HttpException('Failed to fetch subchallenges', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
