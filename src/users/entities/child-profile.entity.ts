import { Column, Entity, PrimaryColumn } from 'typeorm';

export type ChildGender = 'girl' | 'boy';
export type ChildEnglishLevel = 'A1' | 'A2' | 'B1';

@Entity('child_profiles')
export class ChildProfile {
  @PrimaryColumn()
  userId: string;

  @Column({ default: '' })
  displayName: string;

  @Column({ type: 'int', nullable: true })
  age: number | null;

  @Column({ type: 'varchar', nullable: true })
  gender: ChildGender | null;

  @Column({ type: 'varchar', nullable: true })
  englishLevel: ChildEnglishLevel | null;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
