const MAX_WORLD_FACTS = 8;
const MAX_OPEN_THREADS = 8;
const MAX_RESOLVED_THREADS = 5;
const MAX_FLAGS = 15;
const MAX_VOCAB_EXPOSURES = 10;
const MAX_WORLD_RULES = 5;
const MAX_CONTINUITY_RULES = 5;

function tail<T>(items: T[] | undefined | null, limit: number): T[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(-limit);
}

export function sliceFrameworkForEpisode(
  framework: Record<string, any>,
  outlineItem: Record<string, any>,
): Record<string, any> {
  const miniArcNumber = Number(outlineItem?.miniArcNumber || 1);
  const miniArcPlan = Array.isArray(framework?.miniArcPlan) ? framework.miniArcPlan : [];
  const currentArc =
    miniArcPlan.find((arc: any) => Number(arc?.arcNumber) === miniArcNumber) ||
    miniArcPlan.find((arc: any) => Number(arc?.arcNumber) === 1) ||
    null;

  return {
    seasonPremise: framework?.seasonPremise || '',
    centralProblem: framework?.centralProblem || '',
    dramaticQuestion: framework?.dramaticQuestion || '',
    externalStakes: framework?.externalStakes || '',
    emotionalStakes: framework?.emotionalStakes || '',
    heroWant: framework?.heroWant || '',
    heroNeed: framework?.heroNeed || '',
    antagonisticForce: framework?.antagonisticForce || {},
    rulesOfWorld: tail(framework?.rulesOfWorld, MAX_WORLD_RULES),
    incitingIncident: framework?.incitingIncident || '',
    pointOfNoReturn: framework?.pointOfNoReturn || '',
    midpointReversal: framework?.midpointReversal || '',
    lowPoint: framework?.lowPoint || '',
    finalChallenge: framework?.finalChallenge || '',
    resolution: framework?.resolution || '',
    toneGuide: framework?.toneGuide || '',
    safetyBoundaries: framework?.safetyBoundaries || [],
    recurringMotifs: framework?.recurringMotifs || [],
    currentMiniArc: currentArc,
    episodeNumber: outlineItem?.episodeNumber || null,
  };
}

export function sliceSeasonBibleForEpisode(
  seasonBible: Record<string, any>,
  outlineItem: Record<string, any>,
): Record<string, any> {
  const vocabularyFocus = Array.isArray(outlineItem?.vocabularyFocus) ? outlineItem.vocabularyFocus : [];

  return {
    worldOverview: seasonBible?.worldOverview || '',
    worldRules: tail(seasonBible?.worldRules, MAX_WORLD_RULES),
    mainLocations: Array.isArray(seasonBible?.mainLocations) ? seasonBible.mainLocations.slice(0, 6) : [],
    mainCharacters: Array.isArray(seasonBible?.mainCharacters) ? seasonBible.mainCharacters.slice(0, 8) : [],
    seasonContinuityRules: tail(seasonBible?.seasonContinuityRules, MAX_CONTINUITY_RULES),
    vocabularyPlan: {
      ...(seasonBible?.vocabularyPlan || {}),
      episodeFocus: vocabularyFocus,
    },
    illustrationStyleGuide: seasonBible?.illustrationStyleGuide || {},
  };
}

export function sliceStoryState(storyState: Record<string, any>): Record<string, any> {
  return {
    seasonProgress: storyState?.seasonProgress || {},
    heroState: storyState?.heroState || {},
    relationships: storyState?.relationships || {},
    inventory: storyState?.inventory || [],
    worldFacts: tail(storyState?.worldFacts as string[], MAX_WORLD_FACTS),
    openThreads: tail(storyState?.openThreads as string[], MAX_OPEN_THREADS),
    resolvedThreads: tail(storyState?.resolvedThreads as string[], MAX_RESOLVED_THREADS),
    flags: tail(storyState?.flags as string[], MAX_FLAGS),
    vocabularyExposures: tail(storyState?.vocabularyExposures as Record<string, any>[], MAX_VOCAB_EXPOSURES),
    lastChoice: storyState?.lastChoice || null,
  };
}

export function buildVocabularyTarget(
  seasonBible: Record<string, any>,
  seasonSetup: Record<string, any> | undefined,
  outlineItem: Record<string, any>,
): Record<string, any> {
  const outlineWords = Array.isArray(outlineItem?.vocabularyFocus) ? outlineItem.vocabularyFocus : [];
  const coreWords = [
    ...new Set([
      ...outlineWords,
      ...(Array.isArray(seasonBible?.vocabularyPlan?.coreWords) ? seasonBible.vocabularyPlan.coreWords : []),
      ...(Array.isArray(seasonSetup?.vocabularyFocus) ? seasonSetup.vocabularyFocus : []),
    ]),
  ].filter(Boolean);

  return {
    coreWords: coreWords.slice(0, 12),
    actionPhrases: Array.isArray(seasonBible?.vocabularyPlan?.actionPhrases)
      ? seasonBible.vocabularyPlan.actionPhrases.slice(0, 8)
      : [],
  };
}

export function summarizeEpisodeForPlan(episode: Record<string, any>): Record<string, any> {
  return {
    episodeNumber: episode?.episodeNumber,
    title: episode?.title,
    miniArcNumber: episode?.miniArcNumber,
    chapterTextPreview: String(episode?.chapterText || '').slice(0, 600),
    choices: Array.isArray(episode?.choices)
      ? episode.choices.map((choice: any) => ({
          id: choice.id,
          text: choice.text,
          choiceType: choice.choiceType,
          expectedStateDiff: choice.expectedStateDiff,
        }))
      : [],
    storyStateDiff: episode?.storyStateDiff || {},
  };
}
