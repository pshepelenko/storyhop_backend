import { SeasonsService } from './seasons.service';

describe('SeasonsService prepared episode media', () => {
  it('retains ready audio duration and reading alignment when a prepared branch becomes live', () => {
    const service = Object.create(SeasonsService.prototype) as Record<string, any>;
    const readingAlignment = {
      status: 'estimated',
      textHash: 'text-hash',
      estimatedRanges: [{ start: 0, end: 4, startSeconds: 0, endSeconds: 2 }],
    };

    const [chunk] = service.prepareAudioChunks('episode-live', {}, [{
      chunkId: 'chunk-1',
      type: 'chapter',
      text: 'A short line.',
      status: 'ready',
      audioUrl: 'https://storage.example/chunk.mp3',
      durationSeconds: 2.5,
      readingAlignment,
    }]);

    expect(chunk.episodeId).toBe('episode-live');
    expect(chunk.durationSeconds).toBe(2.5);
    expect(chunk.readingAlignment).toEqual(readingAlignment);
  });

  it('automatically unlocks prepared art exactly once when the wallet can cover it', async () => {
    const service = Object.create(SeasonsService.prototype) as Record<string, any>;
    service.seasonsRepository = { findOne: jest.fn().mockResolvedValue({ ownerUserId: 'owner-1' }) };
    service.getIllustrationCrystalEligibility = jest.fn().mockResolvedValue({ hasEnoughCrystals: true });
    service.debitIllustrationUnlockIfNeeded = jest.fn().mockResolvedValue(true);
    const entry = { status: 'locked', metadata: {} };

    await expect(service.autoUnlockPreparedIllustrationIfEligible(
      'season-1',
      { episodeId: 'episode-1', episodeNumber: 4 },
      'illustration-1',
      entry,
    )).resolves.toBe(true);

    expect(service.debitIllustrationUnlockIfNeeded).toHaveBeenCalledWith(
      'owner-1', 'season-1', 'episode-1', 4, 'illustration-1',
    );
    expect(entry.status).toBe('ready');

    await expect(service.autoUnlockPreparedIllustrationIfEligible(
      'season-1',
      { episodeId: 'episode-1', episodeNumber: 4 },
      'illustration-1',
      entry,
    )).resolves.toBe(false);
    expect(service.debitIllustrationUnlockIfNeeded).toHaveBeenCalledTimes(1);
  });
});
