import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { CurrentUser } from '../users/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { SessionAuthGuard } from '../users/session-auth.guard';

@Controller('referrals')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post()
  @UseGuards(SessionAuthGuard)
  async createInviteLink(@CurrentUser() user: User) {
    return this.referralService.createInviteLink(user.userId);
  }

  @Post('apply')
  @UseGuards(SessionAuthGuard)
  async applyReferral(@Body() body: { inviteCode: string }, @CurrentUser() user: User) {
    return this.referralService.applyReferral(body.inviteCode, user.userId);
  }

  @Post('award')
  @UseGuards(SessionAuthGuard)
  async awardReferralCrystals(@Body() body: { inviteCode: string }, @CurrentUser() user: User) {
    return this.referralService.awardReferralCrystals(body.inviteCode, user.userId);
  }

  @Get(':inviteCode')
  async getReferral(@Param('inviteCode') inviteCode: string) {
    return this.referralService.getReferralStatus(inviteCode);
  }
}
