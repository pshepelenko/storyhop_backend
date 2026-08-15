import { AuthService } from './auth.service';
import * as argon2 from 'argon2';

describe('AuthService input safeguards', () => {
  it('does not accept a malformed email', async () => {
    const service = new AuthService({} as any, {} as any, {} as any);
    await expect(service.login({ headers: { origin: undefined }, ip: '127.0.0.1', socket: {} } as any, {} as any, 'bad email', 'password123')).rejects.toThrow('Invalid email');
  });

  it('requires an 8-72 character password for signup', async () => {
    const service = new AuthService({} as any, { findAccountByEmail: jest.fn() } as any, {} as any);
    jest.spyOn(service, 'requireUser').mockResolvedValue({ accountType: 'guest' } as any);
    await expect(service.signup({ headers: {} } as any, {} as any, 'child@example.com', 'short')).rejects.toThrow('Password must be 8-72 characters');
  });

  it('converts the current guest in place during signup', async () => {
    const guest = { userId: 'guest-1', accountType: 'guest', email: '', passwordHash: null } as any;
    const sessions = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const users = {
      findAccountByEmail: jest.fn(async () => null),
      save: jest.fn(async (value) => value),
    };
    const service = new AuthService(sessions as any, users as any, { warn: jest.fn() } as any);
    jest.spyOn(service, 'requireUser').mockResolvedValue(guest);
    jest.spyOn(argon2, 'hash').mockResolvedValue('hashed-password');
    const response = { cookie: jest.fn() };
    const request = {
      headers: { origin: 'http://localhost:3001', cookie: 'storyhop_session=old-token' },
    };

    const account = await service.signup(request as any, response as any, 'Parent@Example.com', 'password123');

    expect(account.userId).toBe('guest-1');
    expect(account.accountType).toBe('account');
    expect(account.email).toBe('parent@example.com');
    expect(users.save).toHaveBeenCalledWith(guest);
    expect(sessions.update).toHaveBeenCalled();
    expect(response.cookie).toHaveBeenCalled();
  });
});
