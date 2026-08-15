import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('guest')
  async guest(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const user = await this.authService.createOrRestoreGuest(request, response);
    return { analyticsId: user.userId, accountType: user.accountType, authenticated: user.accountType === 'account', email: user.email || null };
  }

  @Post('signup')
  async signup(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: { email: string; password: string }) {
    const user = await this.authService.signup(request, response, body.email, body.password);
    return { analyticsId: user.userId, accountType: user.accountType, authenticated: true, email: user.email };
  }

  @Post('login')
  async login(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: { email: string; password: string }) {
    const user = await this.authService.login(request, response, body.email, body.password);
    return { analyticsId: user.userId, accountType: user.accountType, authenticated: true, email: user.email };
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.authService.logout(request, response);
    return { ok: true };
  }

  @Get('me')
  me(@Req() request: Request) { return this.authService.getMe(request); }
}
