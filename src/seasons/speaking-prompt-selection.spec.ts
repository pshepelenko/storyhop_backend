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

  it('selects only a unique phrase that includes a new vocabulary word', () => {
    const service = createService();
    const prompt = service.pickUniqueSpeakingPrompt(
      'Mira said, "Please listen to the bell." Then Alan said, "We can go now."',
      'We can go now.',
      new Set(),
      [
        { term: 'listen', exposureType: 'new' },
        { term: 'bell', exposureType: 'review' },
      ],
    );

    expect(prompt).toBe('Please listen to the bell.');
  });

  it('rejects a new episode phrase when no new vocabulary is available', () => {
    const service = createService();
    const prompt = service.pickUniqueSpeakingPrompt(
      'Mira said, "Please listen to the bell."',
      'Please listen to the bell.',
      new Set(),
      [{ term: 'bell', exposureType: 'review' }],
    );

    expect(prompt).toBeNull();
  });

  it('accepts a partial transcript when a meaningful word is missing', () => {
    const service = createService();

    expect(service.speechMatchesTarget('Please listen to the bell.', 'please listen to bell')).toBe(true);
    expect(service.speechMatchesTarget('Please listen to the bell.', 'listen')).toBe(true);
    expect(service.speechMatchesTarget('Please listen to the bell.', 'we can go')).toBe(false);
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
