import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('episodes')
export class Episode {
  @PrimaryColumn()
  episodeId: string;

  @Column()
  seasonId: string;

  @Column()
  episodeNumber: number;

  @Column()
  miniArcNumber: number;

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

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  storyStateDiff: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  illustrationCandidate: Record<string, any>;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  audioChunks: Record<string, any>[];

  @Column()
  generationStatus: string;

  @Column({ type: 'text', nullable: true })
  speakingPrompt: string | null;

  @Column({ type: 'text', nullable: true })
  speakingPhraseKey: string | null;

  @Column()
  promptVersion: string;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
