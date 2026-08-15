import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('demo_stories')
export class DemoStory {
  @PrimaryColumn()
  demoStoryId: string;

  @Column({ unique: true })
  slug: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  scenario: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  framework: Record<string, any>;

  @Column()
  status: string;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
