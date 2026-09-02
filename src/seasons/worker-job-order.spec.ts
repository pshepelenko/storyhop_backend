import { orderSeasonIdsForWorker } from './seasons.service';

describe('orderSeasonIdsForWorker', () => {
  it('does not drop a queued illustration after the former 50-season scan limit', () => {
    const base = new Date('2026-09-02T10:00:00.000Z');
    const prefetchJobs = Array.from({ length: 55 }, (_, index) => ({
      seasonId: `older-season-${index + 1}`,
      jobType: 'prepared_episode',
      createdAt: new Date(base.getTime() + index * 1000),
    }));
    const unlockedIllustration = {
      seasonId: 'newly-unlocked-season',
      jobType: 'image_generation',
      createdAt: new Date(base.getTime() + 60_000),
    };

    const seasonIds = orderSeasonIdsForWorker([...prefetchJobs, unlockedIllustration]);

    expect(seasonIds).toHaveLength(56);
    expect(seasonIds[0]).toBe('newly-unlocked-season');
    expect(seasonIds).toContain('older-season-55');
  });

  it('keeps one season in the pass while preferring its live media job', () => {
    const seasonIds = orderSeasonIdsForWorker([
      {
        seasonId: 'season-with-both-lanes',
        jobType: 'prepared_episode',
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      },
      {
        seasonId: 'season-with-both-lanes',
        jobType: 'image_generation',
        createdAt: new Date('2026-09-02T10:01:00.000Z'),
      },
      {
        seasonId: 'prefetch-only-season',
        jobType: 'prepared_episode',
        createdAt: new Date('2026-09-02T09:00:00.000Z'),
      },
    ]);

    expect(seasonIds).toEqual(['season-with-both-lanes', 'prefetch-only-season']);
  });
});
