import { validateEpisodeOutlineRange } from './episode-outline-validator';

const outlineItem = (episodeNumber: number) => ({
  episodeNumber,
  miniArcNumber: 1,
  title: `Episode ${episodeNumber}`,
  storyPurpose: 'The heroes move the season problem forward.',
  conflict: 'A local obstacle forces a meaningful choice.',
  vocabularyFocus: ['listen'],
  expectedChoiceTheme: 'Ask a friend for help.',
  stateChangeGoal: 'The heroes learn a useful clue.',
  illustrationOpportunity: 'A warm lantern lights the path.',
  cliffhangerOrHook: 'A new sound comes from the tunnel.',
});

describe('validateEpisodeOutlineRange', () => {
  it('accepts an exact complete extension outline', () => {
    const episodes = Array.from({ length: 91 }, (_, index) => outlineItem(index + 6));

    expect(validateEpisodeOutlineRange({
      episodes,
    }, 6, 96)).toMatchObject({ valid: true, issues: [] });
  });

  it('rejects gaps, duplicate numbers, and incomplete fields', () => {
    const result = validateEpisodeOutlineRange({
      episodes: [outlineItem(6), { ...outlineItem(6), vocabularyFocus: [] }],
      continuityCheck: {},
    }, 6, 7);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'episodeNumber 6 is duplicated',
      'episodeNumber 7 is missing',
    ]));
  });
});
