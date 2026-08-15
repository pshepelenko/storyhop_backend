import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User } from './entities/user.entity';
import { ChildProfile, ChildEnglishLevel, ChildGender } from './entities/child-profile.entity';
import { InterfaceLanguage, ReadingTextSize, UserPreference } from './entities/user-preference.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    @InjectRepository(ChildProfile) private readonly childProfilesRepository: Repository<ChildProfile>,
    @InjectRepository(UserPreference) private readonly preferencesRepository: Repository<UserPreference>,
  ) {}

  async findById(userId: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async createGuest(): Promise<User> {
    const now = new Date();
    const user = this.usersRepository.create({
      userId: uuidv4(),
      threadsIDs: [],
      activeThread: '',
      channels: [],
      subscriptions: [],
      narratives: [],
      subchallenges: [],
      email: '',
      childName: '',
      googleId: '',
      accountType: 'guest',
      passwordHash: null,
      createdAt: now,
      lastActiveAt: now,
    });
    return this.usersRepository.save(user);
  }

  async findAccountByEmail(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .andWhere('user.accountType = :accountType', { accountType: 'account' })
      .getOne();
  }

  async save(user: User): Promise<User> {
    user.lastActiveAt = new Date();
    return this.usersRepository.save(user);
  }

  async getChildProfile(userId: string): Promise<ChildProfile | null> {
    return this.childProfilesRepository.findOne({ where: { userId } });
  }

  isChildProfileComplete(profile: ChildProfile | null): boolean {
    return Boolean(profile?.displayName?.trim() && profile.age && profile.gender && profile.englishLevel);
  }

  async saveChildProfile(userId: string, input: { displayName?: string; age?: number; gender?: ChildGender; englishLevel?: ChildEnglishLevel }) {
    const displayName = String(input.displayName || '').trim().slice(0, 40);
    const age = Number(input.age);
    if (!displayName || !Number.isInteger(age) || age < 6 || age > 10 || !['girl', 'boy'].includes(String(input.gender)) || !['A1', 'A2', 'B1'].includes(String(input.englishLevel))) {
      throw new BadRequestException('Child profile is incomplete or invalid');
    }
    const now = new Date();
    const profile = (await this.getChildProfile(userId)) || this.childProfilesRepository.create({ userId, createdAt: now, updatedAt: now });
    profile.displayName = displayName;
    profile.age = age;
    profile.gender = input.gender!;
    profile.englishLevel = input.englishLevel!;
    profile.updatedAt = now;
    await this.childProfilesRepository.save(profile);
    const user = await this.findById(userId);
    if (user.childName !== displayName) {
      user.childName = displayName;
      await this.save(user);
    }
    return profile;
  }

  async getPreferences(userId: string): Promise<UserPreference> {
    const existing = await this.preferencesRepository.findOne({ where: { userId } });
    if (existing) return existing;
    const now = new Date();
    return this.preferencesRepository.save(this.preferencesRepository.create({
      userId, interfaceLanguage: 'english', playbackRate: 1, readingTextSize: 'medium', createdAt: now, updatedAt: now,
    }));
  }

  async updatePreferences(userId: string, input: { interfaceLanguage?: InterfaceLanguage; playbackRate?: number; readingTextSize?: ReadingTextSize }) {
    const preference = await this.getPreferences(userId);
    if (input.interfaceLanguage !== undefined) {
      if (!['english', 'russian'].includes(input.interfaceLanguage)) throw new BadRequestException('Invalid interface language');
      preference.interfaceLanguage = input.interfaceLanguage;
    }
    if (input.playbackRate !== undefined) {
      if (![0.9, 1, 1.15].includes(Number(input.playbackRate))) throw new BadRequestException('Invalid playback rate');
      preference.playbackRate = Number(input.playbackRate);
    }
    if (input.readingTextSize !== undefined) {
      if (!['small', 'medium', 'large'].includes(input.readingTextSize)) throw new BadRequestException('Invalid reading text size');
      preference.readingTextSize = input.readingTextSize;
    }
    preference.updatedAt = new Date();
    return this.preferencesRepository.save(preference);
  }
}
