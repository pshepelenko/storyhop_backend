import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './stories/entities/user.entity';
import { v4 as uuidv4 } from 'uuid';
import { Client } from './chats/entities/client.entity';

export class Finder {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Client)
    private clientsRepository: Repository<Client>,
  ) {}

  async findUser(
    channel: string,
    userId: string,
    userFullName ='',
    userTelegramAlias ='',    
    ): Promise<User> {
    let user: User;
    
    user = await this.usersRepository.createQueryBuilder("user")
    .where("user.userId = :userId", { userId })
    .orWhere("user.channels @> :channel", { channel: JSON.stringify([{ channelName: channel, channelId: userId }]) })
    .getOne();
    
    if (!user) {
      // Create a new user if not exists
      const primaryUserId = uuidv4()
      user = this.usersRepository.create({
        userId: primaryUserId,
        channels: [{ channelName: channel, channelId: userId ==='default' ? primaryUserId : userId, userAlias: userTelegramAlias, userFullName: userFullName}],
        threadsIDs: [],
        subscriptions: [{
          channelId: channel, 
          chatbotId: 'storybot',
          plan: 'free',
          limit: 20,
          expirationDate: new Date()
        }],
        activeThread: '',
        email: '',
        childName: '',
        googleId: '',
        narratives: ['Не делай с другими того, чего не хочешь себе', 'Помогай тем, кто в беде', 'Мир не черно-белый. У каждого есть своя правда', 'Признавать ошибки — это проявление силы, а не слабости', 'Любопытство — путь к открытиям', 'Не бойся задавать вопросы', 'Ошибки — часть пути', 'Главное — учиться, а не всегда побеждать', 'Сначала выслушай, потом делай выводы', 'Не суди, не зная всей истории', 'Конфликты можно решать мирно', 'Смелость — это действовать, даже когда страшно', 'Сила — это не только мышцы, но и доброта', 'Чем больше сила, тем выше ответственность', 'Главное — быть собой, а не тем, кем хотят тебя видеть другие', 'Терпение приносит плоды'],
        subchallenges: [],
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });
      await this.usersRepository.save(user);
    }
    
    return user
  }
  async findAssistant(chatbotId: string): Promise<string> {
    let client: Client;
    
    client = await this.clientsRepository.createQueryBuilder("client")
      .where("client.assistants @> :assistant", { assistant: JSON.stringify([{ chatbotId }]) })
      .getOne();
    
    if (client) {
      const assistant = client.assistants.find(a => a.chatbotId === chatbotId);
      if (assistant) {
        return assistant.assistantId;
      } else {
        throw new Error(`Assistant with chatbotId ${chatbotId} not found`);
      }
    } else {
      throw new Error(`Client with chatbotId ${chatbotId} not found`);
    }
  }

  // async findActiveThread(userId: string, channel: string): Promise<string> {
  //   return 'aaa'
  // }

}
