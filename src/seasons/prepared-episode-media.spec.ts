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

  it('restores a recovered prepared chunk with alignment before it becomes live', async () => {
    const service = Object.create(SeasonsService.prototype) as Record<string, any>;
    const prepared = {
      preparedEpisodeId: 'prepared-1',
      status: 'ready_text_audio_partial',
      payload: {
        preparedAudioChunks: [{
          chunkId: 'chunk-1',
          type: 'chapter',
          text: 'A short line.',
          status: 'pending',
          audioUrl: null,
        }],
      },
    };
    const estimatedAlignment = {
      status: 'estimated',
      textHash: 'text-hash',
      estimatedRanges: [{ start: 0, end: 12, startSeconds: 0, endSeconds: 2.5 }],
    };
    service.generationJobsRepository = {
      find: jest.fn().mockResolvedValue([{
        jobType: 'prepared_tts_chunk',
        status: 'ready',
        seasonId: 'season-1',
        payload: { text: 'A short line.', metadata: { preparedEpisodeId: 'prepared-1', chunkId: 'chunk-1' } },
        result: { chunkId: 'chunk-1', audioUrl: 'https://storage.example/chunk.mp3', durationSeconds: 2.5 },
      }]),
    };
    service.preparedEpisodesRepository = {
      findOne: jest.fn().mockResolvedValue(prepared),
      save: jest.fn().mockResolvedValue(prepared),
    };
    service.readingAlignment = { buildEstimated: jest.fn().mockReturnValue(estimatedAlignment) };
    service.logger = { warn: jest.fn() };
    service.dataSource = { manager: {} };
    service.enqueueReadingAlignmentJob = jest.fn().mockResolvedValue({ jobId: 'alignment-1' });
    service.scheduleReadingAlignment = jest.fn();

    await expect(service.reconcilePreparedAudioChunksForSeason('season-1')).resolves.toBe(1);

    const [recovered] = prepared.payload.preparedAudioChunks as Record<string, any>[];
    expect(recovered.durationSeconds).toBe(2.5);
    expect(recovered.readingAlignment).toEqual(estimatedAlignment);
    expect(service.enqueueReadingAlignmentJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: 'prepared',
      preparedEpisodeId: 'prepared-1',
      chunkId: 'chunk-1',
    }));
    expect(service.scheduleReadingAlignment).toHaveBeenCalledWith('alignment-1', false);

    const [liveChunk] = service.prepareAudioChunks('episode-live', {}, prepared.payload.preparedAudioChunks);
    expect(liveChunk.readingAlignment).toEqual(estimatedAlignment);
    expect(liveChunk.durationSeconds).toBe(2.5);
  });

  it('does not backfill alignment for an already ready prepared chunk', async () => {
    const service = Object.create(SeasonsService.prototype) as Record<string, any>;
    const prepared = {
      preparedEpisodeId: 'prepared-1',
      status: 'ready',
      payload: {
        preparedAudioChunks: [{
          chunkId: 'chunk-1',
          type: 'chapter',
          text: 'A short line.',
          status: 'ready',
          audioUrl: 'https://storage.example/chunk.mp3',
          durationSeconds: 2.5,
        }],
      },
    };
    service.generationJobsRepository = {
      find: jest.fn().mockResolvedValue([{
        jobType: 'prepared_tts_chunk',
        status: 'ready',
        seasonId: 'season-1',
        payload: { text: 'A short line.', metadata: { preparedEpisodeId: 'prepared-1', chunkId: 'chunk-1' } },
        result: { chunkId: 'chunk-1', audioUrl: 'https://storage.example/chunk.mp3', durationSeconds: 2.5 },
      }]),
    };
    service.preparedEpisodesRepository = {
      findOne: jest.fn().mockResolvedValue(prepared),
      save: jest.fn(),
    };
    service.readingAlignment = { buildEstimated: jest.fn() };
    service.logger = { warn: jest.fn() };
    service.dataSource = { manager: {} };
    service.enqueueReadingAlignmentJob = jest.fn();
    service.scheduleReadingAlignment = jest.fn();

    await expect(service.reconcilePreparedAudioChunksForSeason('season-1')).resolves.toBe(0);

    expect(service.preparedEpisodesRepository.save).not.toHaveBeenCalled();
    expect(service.readingAlignment.buildEstimated).not.toHaveBeenCalled();
    expect(service.enqueueReadingAlignmentJob).not.toHaveBeenCalled();
    expect(service.scheduleReadingAlignment).not.toHaveBeenCalled();
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
