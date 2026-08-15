import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('generation_jobs')
export class GenerationJob {
  @PrimaryColumn()
  jobId: string;

  @Column()
  seasonId: string;

  @Column({ nullable: true })
  episodeId: string | null;

  @Column()
  jobType: string;

  @Column()
  status: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  payload: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  result: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column()
  promptVersion: string;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
