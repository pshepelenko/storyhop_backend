import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('season_frameworks')
export class SeasonFramework {
  @PrimaryColumn()
  id: string;

  @Column()
  seasonId: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  framework: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  seasonBible: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  episodeOutline: Record<string, any>;

  @Column()
  generationStatus: string;

  @Column()
  promptVersion: string;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
