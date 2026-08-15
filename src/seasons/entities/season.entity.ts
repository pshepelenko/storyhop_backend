import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('seasons')
export class Season {
  @PrimaryColumn()
  seasonId: string;

  @Column()
  ownerUserId: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  childProfile: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  seasonSetup: Record<string, any>;

  @Column()
  status: string;

  @Column()
  promptVersion: string;

  @Column({ default: 1 })
  currentEpisodeNumber: number;

  @Column({ default: 1 })
  currentMiniArc: number;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  storyState: Record<string, any>;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
