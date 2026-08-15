import { Column, Entity, PrimaryColumn } from 'typeorm';

export type InterfaceLanguage = 'russian' | 'english';
export type ReadingTextSize = 'small' | 'medium' | 'large';

@Entity('user_preferences')
export class UserPreference {
  @PrimaryColumn()
  userId: string;

  @Column({ type: 'varchar', default: 'english' })
  interfaceLanguage: InterfaceLanguage;

  @Column({ type: 'numeric', precision: 3, scale: 2, default: 1 })
  playbackRate: number;

  @Column({ type: 'varchar', default: 'medium' })
  readingTextSize: ReadingTextSize;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
