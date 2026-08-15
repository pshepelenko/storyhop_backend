import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { Referral } from '../seasons/entities/referral.entity';
import { CrystalWallet } from '../seasons/entities/crystal-wallet.entity';
import { CrystalLedgerEntry } from '../seasons/entities/crystal-ledger.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Referral, CrystalWallet, CrystalLedgerEntry])],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
