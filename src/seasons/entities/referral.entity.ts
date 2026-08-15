import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('referrals')
export class Referral {
  @PrimaryColumn()
  id: string;

  @Column()
  inviterUserId: string;

  @Column()
  invitedUserId: string | null;

  @Column()
  inviteCode: string;

  @Column()
  status: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, any>;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
