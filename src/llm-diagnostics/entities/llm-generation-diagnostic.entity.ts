import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('llm_generation_diagnostics')
export class LlmGenerationDiagnostic {
  @PrimaryColumn()
  diagnosticId: string;

  @Column({ nullable: true })
  seasonId: string | null;

  @Column({ nullable: true })
  jobId: string | null;

  @Column()
  stage: string;

  @Column()
  attempt: number;

  @Column()
  failureKind: string;

  @Column()
  model: string;

  @Column({ type: 'jsonb', nullable: true })
  requestedProvider: Record<string, unknown> | null;

  @Column({ nullable: true })
  actualProvider: string | null;

  @Column({ type: 'integer', nullable: true })
  durationMs: number | null;

  @Column({ type: 'integer', nullable: true })
  httpStatus: number | null;

  @Column({ nullable: true })
  responseId: string | null;

  @Column({ nullable: true })
  finishReason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  usage: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  validationIssues: string[] | null;

  @Column({ type: 'text', nullable: true })
  payloadCiphertext: string | null;

  @Column({ type: 'varchar', nullable: true })
  encryptionIv: string | null;

  @Column({ type: 'varchar', nullable: true })
  encryptionAuthTag: string | null;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
