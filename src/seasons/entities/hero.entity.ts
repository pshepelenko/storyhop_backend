import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('heroes')
export class Hero {
  @PrimaryColumn()
  seasonId: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  heroProfile: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  heroVisualBrief: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  heroReferenceImageUrl: string | null;

  @Column()
  generationStatus: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  heroPreferences: Record<string, any>;

  @Column()
  promptVersion: string;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
