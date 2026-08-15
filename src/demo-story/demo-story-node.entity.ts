import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('demo_story_nodes')
export class DemoStoryNode {
  @PrimaryColumn()
  nodeId: string;

  @Column()
  demoStoryId: string;

  @Column()
  nodeKey: string;

  @Column()
  episodeNumber: number;

  @Column()
  title: string;

  @Column({ type: 'text' })
  chapterText: string;

  @Column({ type: 'text' })
  introOptionsPhrase: string;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  highlightedVocabulary: Record<string, any>[];

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  choices: Record<string, any>[];

  @Column({ type: 'text' })
  illustrationPrompt: string;

  @Column({ type: 'text', nullable: true })
  imageUrl: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  audioChunks: Record<string, any>[];

  @Column({ default: false })
  isStart: boolean;

  @Column({ default: false })
  isEnding: boolean;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
