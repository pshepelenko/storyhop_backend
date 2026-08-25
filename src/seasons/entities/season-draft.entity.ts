import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('season_drafts')
export class SeasonDraft {
  @PrimaryColumn()
  draftId: string;

  @Column()
  ownerUserId: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, any>;

  @Column({ default: 1 })
  step: number;

  @Column({ default: 'active' })
  status: 'active' | 'submitted' | 'abandoned';

  @Column({ nullable: true })
  createdSeasonId: string | null;

  @Column({ nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
