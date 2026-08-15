import {
  buildVocabularyTarget,
  sliceFrameworkForEpisode,
  sliceSeasonBibleForEpisode,
  sliceStoryState,
} from './story-context.util';

describe('story-context.util', () => {
  it('sliceFrameworkForEpisode keeps current mini arc', () => {
    const framework = {
      seasonPremise: 'A long premise',
      centralProblem: 'Problem',
      miniArcPlan: [
        { arcNumber: 1, localGoal: 'start' },
        { arcNumber: 3, localGoal: 'deep' },
      ],
    };

    const sliced = sliceFrameworkForEpisode(framework, { episodeNumber: 20, miniArcNumber: 3 });
    expect(sliced.currentMiniArc).toEqual({ arcNumber: 3, localGoal: 'deep' });
    expect(sliced.episodeNumber).toBe(20);
  });

  it('sliceStoryState tails long arrays', () => {
    const state = {
      worldFacts: Array.from({ length: 20 }, (_, i) => `fact-${i}`),
      openThreads: ['a', 'b', 'c'],
      seasonProgress: { currentMiniArc: 2 },
    };

    const sliced = sliceStoryState(state);
    expect(sliced.worldFacts).toHaveLength(8);
    expect(sliced.worldFacts[0]).toBe('fact-12');
    expect(sliced.seasonProgress).toEqual({ currentMiniArc: 2 });
  });

  it('buildVocabularyTarget merges outline and bible words', () => {
    const target = buildVocabularyTarget(
      { vocabularyPlan: { coreWords: ['help'], actionPhrases: ['work together'] } },
      { vocabularyFocus: ['brave'] },
      { vocabularyFocus: ['listen'] },
    );
    expect(target.coreWords).toEqual(expect.arrayContaining(['help', 'brave', 'listen']));
  });

  it('sliceSeasonBibleForEpisode includes episode vocabulary focus', () => {
    const sliced = sliceSeasonBibleForEpisode(
      { worldOverview: 'A bright world', vocabularyPlan: { coreWords: ['map'] } },
      { vocabularyFocus: ['river'] },
    );
    expect(sliced.vocabularyPlan.episodeFocus).toEqual(['river']);
  });
});
