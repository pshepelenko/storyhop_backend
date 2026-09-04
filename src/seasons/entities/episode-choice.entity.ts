import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('episode_choices')
export class EpisodeChoice {
  @PrimaryColumn()
  choiceRecordId: string;

  @Column()
  seasonId: string;

  @Column()
  episodeId: string;

  @Column()
  episodeNumber: number;

  @Column()
  choiceId: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  choicePayload: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  resultingStoryState: Record<string, any>;

  @Column({ default: 'ready' })
  generationStatus: 'queued' | 'processing' | 'ready' | 'failed';

  @Column({ nullable: true })
  generationJobId: string | null;

  @Column({ type: 'integer', nullable: true })
  targetEpisodeNumber: number | null;

  @Column({ type: 'text', nullable: true })
  generationError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  updatedAt: Date | null;

  @Column({ type: 'timestamp' })
  createdAt: Date;
}
