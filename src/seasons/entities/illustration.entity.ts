import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('illustrations')
export class Illustration {
  @PrimaryColumn()
  illustrationId: string;

  @Column()
  seasonId: string;

  @Column({ nullable: true })
  episodeId: string | null;

  @Column()
  entryType: string;

  @Column()
  title: string;

  @Column()
  status: string;

  @Column({ type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  promptPayload: Record<string, any>;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
