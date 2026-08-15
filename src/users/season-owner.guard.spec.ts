import { NotFoundException } from '@nestjs/common';
import { SeasonOwnerGuard } from './season-owner.guard';

describe('SeasonOwnerGuard', () => {
  const repository = { findOne: jest.fn() };
  const guard = new SeasonOwnerGuard(repository as any);

  beforeEach(() => jest.clearAllMocks());

  it('passes non-season routes to the session guard', async () => {
    const context = { switchToHttp: () => ({ getRequest: () => ({ params: {}, authUser: { userId: 'u1' } }) }) };
    await expect(guard.canActivate(context as any)).resolves.toBe(true);
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('loads only a season owned by the authenticated user', async () => {
    const season = { seasonId: 's1', ownerUserId: 'u1' };
    repository.findOne.mockResolvedValue(season);
    const request = { params: { seasonId: 's1' }, authUser: { userId: 'u1' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };

    await expect(guard.canActivate(context as any)).resolves.toBe(true);
    expect(repository.findOne).toHaveBeenCalledWith({ where: { seasonId: 's1', ownerUserId: 'u1' } });
    expect((request as any).season).toBe(season);
  });

  it('returns 404 for another user season', async () => {
    repository.findOne.mockResolvedValue(null);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ params: { seasonId: 's2' }, authUser: { userId: 'u1' } }) }),
    };
    await expect(guard.canActivate(context as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
