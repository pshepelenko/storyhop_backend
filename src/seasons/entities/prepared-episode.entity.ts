import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('prepared_episodes')
export class PreparedEpisode {
  @PrimaryColumn()
  preparedEpisodeId: string;

  @Column()
  seasonId: string;

  @Column()
  sourceEpisodeId: string;

  @Column()
  sourceEpisodeNumber: number;

  @Column()
  choiceId: string;

  @Column()
  nextEpisodeNumber: number;

  @Column()
  status: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  payload: Record<string, any>;

  @Column()
  promptVersion: string;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
