import {
  BadRequestException,
  Injectable,
  NotFoundException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { FileLogger } from '../logging/file-logger.service';
import { AuthSession } from './entities/auth-session.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { configuredAllowedOrigins } from '../security/origin-policy';

const SESSION_COOKIE = 'storyhop_session';
const SESSION_DAYS = 30;
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, number[]>();

  constructor(
    @InjectRepository(AuthSession) private readonly sessionsRepository: Repository<AuthSession>,
    private readonly usersService: UsersService,
    private readonly logger: FileLogger,
  ) {}

  async requireUser(request: Request): Promise<User> {
    const token = this.extractSessionToken(request);
    if (!token) throw new UnauthorizedException('Authentication required');
    const session = await this.sessionsRepository.findOne({ where: { tokenHash: this.hashToken(token) } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired');
    }
    session.lastUsedAt = new Date();
    await this.sessionsRepository.save(session);
    return this.usersService.findById(session.userId);
  }

  async createOrRestoreGuest(request: Request, response: Response): Promise<User> {
    this.assertMutationOrigin(request);
    try {
      const existing = await this.requireUser(request);
      this.setSessionCookie(response, this.extractSessionToken(request)!);
      return existing;
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        throw error;
      }
      const user = await this.usersService.createGuest();
      await this.createSession(user, response);
      return user;
    }
  }

  async signup(request: Request, response: Response, emailInput: string, password: string): Promise<User> {
    this.assertMutationOrigin(request);
    const currentUser = await this.requireUser(request);
    if (currentUser.accountType !== 'guest') throw new BadRequestException('Account already registered');
    const email = this.normalizeEmail(emailInput);
    this.validatePassword(password);
    if (await this.usersService.findAccountByEmail(email)) throw new BadRequestException('Email is already registered');

    currentUser.email = email;
    currentUser.passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    currentUser.accountType = 'account';
    const user = await this.usersService.save(currentUser);
    await this.revokeSessionToken(this.extractSessionToken(request));
    await this.createSession(user, response);
    return user;
  }

  async login(request: Request, response: Response, emailInput: string, password: string): Promise<User> {
    this.assertMutationOrigin(request);
    const email = this.normalizeEmail(emailInput);
    const key = `${this.clientIp(request)}:${email}`;
    this.assertLoginRateLimit(key);
    const user = await this.usersService.findAccountByEmail(email);
    const valid = Boolean(user?.passwordHash && await argon2.verify(user.passwordHash, password || ''));
    if (!valid || !user) {
      this.recordLoginFailure(key);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.loginAttempts.delete(key);
    await this.createSession(user, response);
    return user;
  }

  async logout(request: Request, response: Response): Promise<void> {
    this.assertMutationOrigin(request);
    await this.revokeSessionToken(this.extractSessionToken(request));
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  async getMe(request: Request) {
    try {
      const user = await this.requireUser(request);
      return { analyticsId: user.userId, accountType: user.accountType, authenticated: user.accountType === 'account', email: user.email || null };
    } catch {
      return { analyticsId: null, accountType: null, authenticated: false, email: null };
    }
  }

  assertMutationOrigin(request: Request) {
    const origin = request.headers.origin;
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        throw new NotFoundException('Not found');
      }
      return;
    }
    const allowedOrigins = this.allowedOrigins();
    if (!allowedOrigins.includes(origin)) throw new NotFoundException('Not found');
  }

  private async createSession(user: User, response: Response) {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.sessionsRepository.save(this.sessionsRepository.create({
      sessionId: uuidv4(), tokenHash: this.hashToken(token), userId: user.userId,
      expiresAt, revokedAt: null, lastUsedAt: now, createdAt: now,
    }));
    this.setSessionCookie(response, token, expiresAt);
  }

  private async revokeSessionToken(token?: string) {
    if (!token) return;
    await this.sessionsRepository.update({ tokenHash: this.hashToken(token) }, { revokedAt: new Date() });
  }

  private extractSessionToken(request: Request): string | undefined {
    const value = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    return value ? decodeURIComponent(value.slice(SESSION_COOKIE.length + 1)) : undefined;
  }

  private setSessionCookie(response: Response, token: string, expires?: Date) {
    response.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), expires: expires || new Date(Date.now() + SESSION_DAYS * 86400000) });
  }

  private cookieOptions() {
    const domain = process.env.SESSION_COOKIE_DOMAIN;
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', ...(domain ? { domain } : {}) };
  }

  private allowedOrigins(): string[] {
    return configuredAllowedOrigins();
  }

  private normalizeEmail(value: string) {
    const email = String(value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Invalid email');
    return email;
  }

  private validatePassword(password: string) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new BadRequestException('Password must be 8-72 characters');
  }

  private assertLoginRateLimit(key: string) {
    const cutoff = Date.now() - LOGIN_WINDOW_MS;
    const attempts = (this.loginAttempts.get(key) || []).filter((time) => time > cutoff);
    this.loginAttempts.set(key, attempts);
    if (attempts.length >= LOGIN_LIMIT) throw new HttpException('Too many login attempts', 429);
  }

  private recordLoginFailure(key: string) {
    const attempts = this.loginAttempts.get(key) || [];
    attempts.push(Date.now());
    this.loginAttempts.set(key, attempts);
    this.logger.warn(`[Auth] login_failed key=${createHash('sha256').update(key).digest('hex').slice(0, 12)}`);
  }

  private clientIp(request: Request) { return request.ip || request.socket.remoteAddress || 'unknown'; }
  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
}
