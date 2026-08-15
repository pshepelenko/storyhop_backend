import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('learning_events')
export class LearningEvent {
  @PrimaryColumn({ name: 'event_id' })
  eventId: string;

  @Column({ name: 'owner_user_id' })
  ownerUserId: string;

  @Column({ name: 'season_id', nullable: true })
  seasonId: string | null;

  @Column({ name: 'episode_id', nullable: true })
  episodeId: string | null;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'payload_json', type: 'jsonb', default: {} })
  payloadJson: Record<string, any>;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
