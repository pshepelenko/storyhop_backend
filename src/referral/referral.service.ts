import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Referral } from '../seasons/entities/referral.entity';
import { CrystalWallet } from '../seasons/entities/crystal-wallet.entity';
import { CrystalLedgerEntry } from '../seasons/entities/crystal-ledger.entity';

@Injectable()
export class ReferralService {
  constructor(
    @InjectRepository(Referral)
    private readonly referralRepository: Repository<Referral>,
  ) {}

  async createInviteLink(userId: string): Promise<{ inviteCode: string; inviteLink: string }> {
    const inviteCode = uuidv4().substring(0, 8);
    const referral = this.referralRepository.create({
      id: uuidv4(),
      inviterUserId: userId,
      invitedUserId: null,
      inviteCode,
      status: 'created',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await this.referralRepository.save(referral);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    return {
      inviteCode,
      inviteLink: `${frontendUrl}/invite/${inviteCode}`,
    };
  }

  async getReferralStatus(inviteCode: string): Promise<{ inviteCode: string; valid: boolean }> {
    const normalizedCode = String(inviteCode || '').trim();
    if (!normalizedCode) return { inviteCode: '', valid: false };
    const referral = await this.referralRepository.findOne({ where: { inviteCode: normalizedCode } });
    return { inviteCode: normalizedCode, valid: referral?.status === 'created' };
  }

  async applyReferral(inviteCode: string, invitedUserId: string): Promise<{ rewarded: boolean }> {
    const normalizedInviteCode = String(inviteCode || '').trim();
    const normalizedInvitedUserId = String(invitedUserId || '').trim();
    if (!normalizedInviteCode || !normalizedInvitedUserId) {
      return { rewarded: false };
    }

    return this.referralRepository.manager.transaction(async (manager) => {
      // Serialize all referral applications for one guest, even across different invite codes.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [normalizedInvitedUserId]);
      const referrals = manager.getRepository(Referral);
      const referral = await referrals.createQueryBuilder('referral')
        .setLock('pessimistic_write')
        .where('referral.inviteCode = :inviteCode', { inviteCode: normalizedInviteCode })
        .andWhere('referral.status = :status', { status: 'created' })
        .getOne();
      if (!referral || referral.inviterUserId === normalizedInvitedUserId) {
        return { rewarded: false };
      }

      const existingReferralForInvitedUser = await referrals.findOne({
        where: { invitedUserId: normalizedInvitedUserId },
      });
      if (existingReferralForInvitedUser) {
        return { rewarded: false };
      }

      referral.invitedUserId = normalizedInvitedUserId;
      referral.status = 'invited';
      referral.updatedAt = new Date();
      await referrals.save(referral);
      return { rewarded: true };
    });
  }

  async awardReferralCrystals(inviteCode: string, invitedUserId: string): Promise<{ awarded: boolean; amount: number }> {
    return this.referralRepository.manager.transaction(async (manager) => {
      const referrals = manager.getRepository(Referral);
      const wallets = manager.getRepository(CrystalWallet);
      const ledger = manager.getRepository(CrystalLedgerEntry);
      const referral = await referrals.createQueryBuilder('referral')
        .setLock('pessimistic_write')
        .where('referral.inviteCode = :inviteCode', { inviteCode })
        .andWhere('referral.status = :status', { status: 'invited' })
        .getOne();

      if (!referral || referral.invitedUserId !== invitedUserId) {
        return { awarded: false, amount: 0 };
      }

      const ownerWallets = await wallets.find({
        where: { ownerUserId: referral.inviterUserId },
        order: { createdAt: 'ASC' },
      });
      const wallet = ownerWallets[0];
      if (!wallet) return { awarded: false, amount: 0 };

      const awardAmount = 10;
      await ledger.save(ledger.create({
        ledgerEntryId: uuidv4(),
        walletId: wallet.walletId,
        ownerUserId: referral.inviterUserId,
        seasonId: wallet.seasonId,
        direction: 'credit',
        amount: awardAmount,
        reason: 'referral',
        metadata: { inviteCode, invitedUserId: referral.invitedUserId },
        createdAt: new Date(),
      }));

      const entries = await ledger.find({ where: { ownerUserId: referral.inviterUserId } });
      const balance = Math.max(entries.reduce((sum, entry) => {
        const amount = Math.max(Number(entry.amount || 0), 0);
        return sum + (entry.direction === 'debit' ? -amount : amount);
      }, 0), 0);
      for (const ownerWallet of ownerWallets) {
        ownerWallet.balance = balance;
        ownerWallet.updatedAt = new Date();
      }
      await wallets.save(ownerWallets);

      referral.status = 'completed';
      referral.updatedAt = new Date();
      await referrals.save(referral);
      return { awarded: true, amount: awardAmount };
    });
  }

}
