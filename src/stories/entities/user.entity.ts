import { PrimaryColumn, Column, Entity } from 'typeorm';

@Entity("users")
export class User {
    @PrimaryColumn()
    userId: string;
  
    @Column("text", { array: true })
    threadsIDs: string[];

    @Column()
    activeThread: string;

    @Column({
      type: 'jsonb',
      array: false,
      default: () => "'[]'",
      nullable: true,
    })
    public channels: Array<{ 
      channelName: string, 
      channelId: string,
      userFullName: string,
      userAlias: string
    }>;

    @Column({
      type: 'jsonb',
      array: false,
      default: () => "'[]'",
      nullable: true,
    })
    public  subscriptions: Array<{
      channelId: string;
      chatbotId: string;
      plan: string;
      limit: number;
      expirationDate: Date;
    }>;

    @Column("text", { array: true })
    narratives: string[];

    @Column("text", { array: true })
    subchallenges: string[];
    
    @Column()
    email: string;

    @Column()
    childName: string;
    
    @Column()
    googleId: string;

    @Column()
    createdAt: Date;

    @Column()
    lastActiveAt: Date;

  }

