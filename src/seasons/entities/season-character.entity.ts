import { Column, Entity, PrimaryColumn } from 'typeorm';

export type SeasonCharacterRole =
  | 'main_hero'
  | 'recurring_companion'
  | 'child_ally'
  | 'magical_helper'
  | 'mentor'
  | 'antagonist'
  | 'minor_character';

export type SeasonCharacterCountRule =
  | 'exactly_one_when_selected'
  | 'optional_once'
  | 'background_only';

@Entity('season_characters')
export class SeasonCharacter {
  @PrimaryColumn()
  characterId: string;

  @Column()
  seasonId: string;

  @Column()
  displayName: string;

  @Column({ nullable: true })
  internalName: string | null;

  @Column({ nullable: true })
  safeDisplayName: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  aliases: string[];

  @Column()
  role: SeasonCharacterRole;

  @Column()
  type: string;

  @Column({ type: 'int', nullable: true })
  ageYears: number | null;

  @Column({ type: 'text' })
  visualDescription: string;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  mainColors: string[];

  @Column({ type: 'text', nullable: true })
  silhouette: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  signatureItems: string[];

  @Column({ type: 'text', nullable: true })
  personalityVisualCues: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  allowedVariations: string[];

  @Column({
    type: 'jsonb',
    default: () => "'[]'",
  })
  doNotShow: string[];

  @Column({ default: 'exactly_one_when_selected' })
  countRule: SeasonCharacterCountRule;

  @Column({ type: 'text', nullable: true })
  duplicatePrevention: string | null;

  @Column({ type: 'text', nullable: true })
  placementPreference: string | null;

  @Column({ type: 'text', nullable: true })
  referenceImageUrl: string | null;

  @Column({ type: 'text', nullable: true })
  referenceUse: string | null;

  @Column({ default: false })
  needsReview: boolean;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
