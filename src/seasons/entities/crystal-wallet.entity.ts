import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('crystal_wallets')
export class CrystalWallet {
  @PrimaryColumn()
  walletId: string;

  @Column()
  ownerUserId: string;

  @Column()
  seasonId: string;

  @Column({ default: 0 })
  balance: number;

  @Column({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp' })
  updatedAt: Date;
}
