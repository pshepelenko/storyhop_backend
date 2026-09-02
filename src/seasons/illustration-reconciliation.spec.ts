import { SeasonsService } from './seasons.service';

describe('SeasonsService illustration reconciliation', () => {
  it('fails a stale unlocked illustration with no active image job', async () => {
    const service = Object.create(SeasonsService.prototype) as Record<string, any>;
    const entry = {
      storybookEntryId: 'entry-1',
      seasonId: 'season-1',
      episodeId: 'episode-1',
      illustrationId: 'illustration-1',
      entryType: 'episode_illustration',
      status: 'queued',
      updatedAt: new Date(Date.now() - 21 * 60 * 1000),
    };

    service.storybookEntriesRepository = {
      find: jest.fn().mockResolvedValue([entry]),
    };
    service.illustrationsRepository = {
      findOne: jest.fn().mockResolvedValue({
        illustrationId: 'illustration-1',
        episodeId: 'episode-1',
        status: 'queued',
        imageUrl: null,
        updatedAt: new Date(Date.now() - 21 * 60 * 1000),
      }),
    };
    service.isIllustrationJobInProgress = jest.fn().mockResolvedValue(false);
    service.failIllustrationUnlock = jest.fn().mockResolvedValue(3);
    service.logger = { warn: jest.fn() };

    await expect(service.reconcileStaleIllustrationUnlocks()).resolves.toBe(1);
    expect(service.failIllustrationUnlock).toHaveBeenCalledWith({
      seasonId: 'season-1',
      episodeId: 'episode-1',
      illustrationId: 'illustration-1',
      storybookEntryId: 'entry-1',
      failureCode: 'missing_generation_job',
    });
  });

  it('leaves a stale illustration alone while its image job is active', async () => {
    const service = Object.create(SeasonsService.prototype) as Record<string, any>;
    service.storybookEntriesRepository = {
      find: jest.fn().mockResolvedValue([{
        storybookEntryId: 'entry-1',
        seasonId: 'season-1',
        episodeId: 'episode-1',
        illustrationId: 'illustration-1',
        entryType: 'episode_illustration',
        status: 'processing',
        updatedAt: new Date(Date.now() - 21 * 60 * 1000),
      }]),
    };
    service.illustrationsRepository = {
      findOne: jest.fn().mockResolvedValue({
        illustrationId: 'illustration-1',
        status: 'processing',
        imageUrl: null,
        updatedAt: new Date(Date.now() - 21 * 60 * 1000),
      }),
    };
    service.isIllustrationJobInProgress = jest.fn().mockResolvedValue(true);
    service.failIllustrationUnlock = jest.fn();
    service.logger = { warn: jest.fn() };

    await expect(service.reconcileStaleIllustrationUnlocks()).resolves.toBe(0);
    expect(service.failIllustrationUnlock).not.toHaveBeenCalled();
  });
});
