import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('storybook_entries')
export class StorybookEntry {
  @PrimaryColumn()
  storybookEntryId: string;

  @Column()
  seasonId: string;

  @Column({ nullable: true })
  episodeId: string | null;

  @Column({ nullable: true })
  illustrationId: string | null;

  @Column()
  entryType: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  summary: string;

  @Column()
  status: string;

  @Column({ default: 0 })
  unlockCost: number;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  metadata: Record<string, any>;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
