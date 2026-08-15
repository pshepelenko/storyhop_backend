import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('crystal_ledger')
export class CrystalLedgerEntry {
  @PrimaryColumn()
  ledgerEntryId: string;

  @Column()
  walletId: string;

  @Column()
  ownerUserId: string;

  @Column()
  seasonId: string;

  @Column()
  direction: string;

  @Column()
  amount: number;

  @Column()
  reason: string;

  @Column({
    type: 'jsonb',
    default: () => "'{}'",
  })
  metadata: Record<string, any>;

  @Column({ type: 'timestamp' })
  createdAt: Date;
}
