type EpisodeOutlineItem = Record<string, unknown>;

export type EpisodeOutlineValidationResult = {
  valid: boolean;
  issues: string[];
  episodes: EpisodeOutlineItem[];
};

const requiredTextFields = [
  'title',
  'storyPurpose',
  'conflict',
  'expectedChoiceTheme',
  'stateChangeGoal',
  'illustrationOpportunity',
  'cliffhangerOrHook',
];

export function validateEpisodeOutlineRange(
  payload: Record<string, any>,
  fromEpisode: number,
  toEpisode: number,
): EpisodeOutlineValidationResult {
  const issues: string[] = [];
  const expectedNumbers = Array.from(
    { length: toEpisode - fromEpisode + 1 },
    (_, index) => fromEpisode + index,
  );
  const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];

  if (episodes.length !== expectedNumbers.length) {
    issues.push(`episodes must contain exactly ${expectedNumbers.length} items, received ${episodes.length}`);
  }

  const itemsByEpisode = new Map<number, EpisodeOutlineItem>();
  for (const item of episodes) {
    const episodeNumber = Number(item?.episodeNumber);
    if (!Number.isInteger(episodeNumber)) {
      issues.push('every episode must have an integer episodeNumber');
      continue;
    }
    if (itemsByEpisode.has(episodeNumber)) {
      issues.push(`episodeNumber ${episodeNumber} is duplicated`);
      continue;
    }
    itemsByEpisode.set(episodeNumber, item);
  }

  for (const episodeNumber of expectedNumbers) {
    const item = itemsByEpisode.get(episodeNumber);
    if (!item) {
      issues.push(`episodeNumber ${episodeNumber} is missing`);
      continue;
    }
    if (!Number.isInteger(Number(item.miniArcNumber)) || Number(item.miniArcNumber) < 1) {
      issues.push(`episodeNumber ${episodeNumber} must have a positive integer miniArcNumber`);
    }
    for (const field of requiredTextFields) {
      if (typeof item[field] !== 'string' || !String(item[field]).trim()) {
        issues.push(`episodeNumber ${episodeNumber} is missing ${field}`);
      }
    }
    if (
      !Array.isArray(item.vocabularyFocus)
      || !item.vocabularyFocus.length
      || item.vocabularyFocus.some((word) => typeof word !== 'string' || !String(word).trim())
    ) {
      issues.push(`episodeNumber ${episodeNumber} must have non-empty vocabularyFocus`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    episodes: expectedNumbers
      .map((episodeNumber) => itemsByEpisode.get(episodeNumber))
      .filter((item): item is EpisodeOutlineItem => Boolean(item)),
  };
}
