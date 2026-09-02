import { SeasonsService } from './seasons.service';

describe('Speaking prompt selection', () => {
  function createService() {
    return Object.create(SeasonsService.prototype) as Record<string, any>;
  }

  it('selects a complete direct-speech phrase written with straight single quotes', () => {
    const service = createService();
    const candidates = service.getSpeakingPromptCandidates(
      "Alan doesn't know the answer yet. Orin said, 'Listen carefully and follow the sound.' Alan listened.",
    );

    expect(candidates).toEqual(['Listen carefully and follow the sound.']);
  });

  it('does not block a prepared legacy episode when no valid phrase can be repaired', async () => {
    const service = createService();
    service.getUsedSpeakingPhrases = jest.fn().mockResolvedValue([]);
    service.logger = { warn: jest.fn() };

    await expect(
      service.ensureUniqueSpeakingPrompt(
        'season-id',
        { chapterText: 'There is no direct speech here.', speakingPrompt: 'broken fragment' },
        'prepared-id',
        true,
      ),
    ).resolves.toMatchObject({ speakingPrompt: '', speakingPhraseKey: '' });
    expect(service.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('continuing without inline Speaking'),
    );
  });
});
