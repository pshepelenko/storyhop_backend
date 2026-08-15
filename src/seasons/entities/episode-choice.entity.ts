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

  @Column({ type: 'timestamp' })
  createdAt: Date;
}
