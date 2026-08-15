export function validateSeasonFramework(framework: Record<string, any>): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const title = String(framework.title || '').trim();
  if (!title || title.length < 3 || title.length > 80) {
    issues.push('title must be a short meaningful season title');
  } else if (/[^\x00-\x7F]/.test(title) || /[.!?:]/.test(title)) {
    issues.push('title must be a short English title without sentence punctuation');
  }

  if (!framework.seasonPremise || framework.seasonPremise.length < 20) {
    issues.push('seasonPremise must be a meaningful 1-2 sentence season idea');
  }

  const centralProblem = framework.centralProblem || '';
  if (!centralProblem || centralProblem.length < 30) {
    issues.push('centralProblem is too short or missing - must describe a serious complex situation');
  }

  if (centralProblem.includes('explore') && !centralProblem.includes('crisis') && !centralProblem.includes('problem')) {
    issues.push('centralProblem sounds like a general setting, not a problem');
  }

  if (!framework.dramaticQuestion || framework.dramaticQuestion.length < 20) {
    issues.push('dramaticQuestion must be the main question the finale must answer');
  }

  if (!framework.externalStakes || framework.externalStakes.length < 15) {
    issues.push('externalStakes must describe what can be lost in the story world');
  }

  if (!framework.emotionalStakes || framework.emotionalStakes.length < 15) {
    issues.push('emotionalStakes must describe what matters emotionally to the hero');
  }

  if (!framework.incitingIncident || framework.incitingIncident.length < 20) {
    issues.push('incitingIncident is missing or too short');
  }

  if (!framework.pointOfNoReturn || framework.pointOfNoReturn.length < 20) {
    issues.push('pointOfNoReturn is missing or too short');
  }

  const miniArcPlan = framework.miniArcPlan;
  if (!Array.isArray(miniArcPlan) || miniArcPlan.length < 3) {
    issues.push('miniArcPlan must have at least 3 arcs');
  } else {
    const functions = miniArcPlan.map((arc: any) => arc.storyFunction);
    if (!functions.some((f: string) => f === 'setup')) {
      issues.push('miniArcPlan must include a setup arc');
    }
    if (!functions.some((f: string) => f === 'escalation')) {
      issues.push('miniArcPlan must include an escalation arc');
    }
    if (!functions.some((f: string) => f?.includes('finale'))) {
      issues.push('miniArcPlan must include a finale preparation arc');
    }
  }

  if (!framework.midpointReversal || framework.midpointReversal.length < 20) {
    issues.push('midpointReversal must describe a false victory or false defeat that changes understanding');
  }

  if (!framework.lowPoint || framework.lowPoint.length < 20) {
    issues.push('lowPoint is missing or too short');
  }

  if (!framework.finalChallenge || framework.finalChallenge.length < 20) {
    issues.push('finalChallenge must describe the final test connected to the central problem');
  }

  if (!framework.resolution || framework.resolution.length < 20) {
    issues.push('resolution must describe how the heroes get out of the crisis');
  }

  if (!framework.characterChange || framework.characterChange.length < 15) {
    issues.push('characterChange must describe how the hero changes by the end');
  }

  const resolution = framework.resolution || '';
  if (
    resolution.includes('suddenly') ||
    resolution.includes('magically') ||
    resolution.includes('by accident')
  ) {
    issues.push('resolution appears unearned - should not rely on sudden, magical, or accidental solutions');
  }

  return { valid: issues.length === 0, issues };
}
