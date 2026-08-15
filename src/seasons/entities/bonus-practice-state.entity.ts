import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('bonus_practice_states')
export class BonusPracticeState {
  @PrimaryColumn()
  stateId: string;

  @Column()
  seasonId: string;

  @Column()
  ownerUserId: string;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  skippedSpeakingQueue: Record<string, any>[];

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  writingState: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  storyRecapState: Record<string, any>;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
