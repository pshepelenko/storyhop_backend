import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('auth_sessions')
export class AuthSession {
  @PrimaryColumn()
  sessionId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Index()
  @Column()
  userId: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamp' })
  createdAt: Date;
}
