import { Column, Entity, PrimaryColumn } from 'typeorm';

export type AccountType = 'guest' | 'account';

/**
 * Active StoryHop identity. It deliberately maps to the existing `users` table
 * so locally created seasons keep their owner ids during the auth migration.
 */
@Entity('users')
export class User {
  @PrimaryColumn()
  userId: string;

  @Column('text', { array: true, default: () => "'{}'" })
  threadsIDs: string[];

  @Column({ default: '' })
  activeThread: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  channels: Array<{ channelName: string; channelId: string; userFullName: string; userAlias: string }>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  subscriptions: Array<{ channelId: string; chatbotId: string; plan: string; limit: number; expirationDate: Date }>;

  @Column('text', { array: true, default: () => "'{}'" })
  narratives: string[];

  @Column('text', { array: true, default: () => "'{}'" })
  subchallenges: string[];

  @Column({ default: '' })
  email: string;

  @Column({ default: '' })
  childName: string;

  @Column({ default: '' })
  googleId: string;

  @Column({ type: 'varchar', default: 'guest' })
  accountType: AccountType;

  @Column({ type: 'text', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  lastActiveAt: Date;
}
