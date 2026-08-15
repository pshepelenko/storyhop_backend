import { Injectable } from '@nestjs/common';
import { SeasonCharacter } from '../entities/season-character.entity';
import {
  COMPANION_SAFE_NAME_OVERRIDES,
  COPYRIGHTED_CHARACTER_NAMES,
  GENERIC_NEGATIVE_PROMPT,
  FRANCHISE_TERMS,
  KNOWN_ALLY_DEFAULTS,
  NEGATIVE_PROMPT_MAX_CHARS,
  POSITIVE_PROMPT_MAX_CHARS,
  PRONOUN_BLOCKLIST,
  TITLE_WORD_BLOCKLIST,
} from './tti-prompt.constants';
import {
  BuildManifestInput,
  CompileContext,
  EpisodeVisualManifest,
  SceneCharacterRef,
  TTIPromptInput,
  TTIPromptOutput,
  TTIPromptValidationIssue,
  TTIPromptValidationResult,
} from './tti-prompt.types';

@Injectable()
export class TtiPromptService {
  private static readonly GENERIC_PROMPT_NAMES = new Set(['elder', 'guardian', 'mentor']);

  buildEpisodeVisualManifest(input: BuildManifestInput): EpisodeVisualManifest {
    const moment = this.cleanText(input.moment);
    const roster = this.deduplicateCharactersForScene(input.characters);
    const sceneCharacters = input.sceneCharacters || [];
    const selectedCharacters: EpisodeVisualManifest['selectedCharacters'] = [];
    const seenKeys = new Set<string>();

    const addCharacter = (entry: EpisodeVisualManifest['selectedCharacters'][number] | null) => {
      if (!entry) {
        return;
      }
      const key = entry.displayName.trim().toLowerCase();
      if (!key || seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      selectedCharacters.push(entry);
    };

    if (sceneCharacters.length) {
      for (const sceneRef of sceneCharacters) {
        if (!this.isCharacterMentionedInMoment(moment, sceneRef, roster)) {
          continue;
        }
        addCharacter(this.toManifestCharacterFromSceneRef(sceneRef, roster));
      }
    } else {
      for (const character of roster) {
        const ref: SceneCharacterRef = {
          name: character.displayName,
          aliases: character.aliases || [],
          role: character.role,
          ageYears: character.ageYears ?? undefined,
          visualDescription: character.visualDescription,
        };
        if (!this.isCharacterMentionedInMoment(moment, ref, roster)) {
          continue;
        }
        addCharacter(this.toManifestCharacter(character));
      }
    }

    return {
      episodeId: input.episodeId,
      seasonId: input.seasonId,
      selectedCharacterIds: selectedCharacters.map((item) => item.characterId),
      selectedCharacters,
      props: [],
      environment: moment ? { visualDescription: moment } : undefined,
      visualEffects: [],
      mood: '',
      keyActionBeat: moment,
    };
  }

  compileTTIPrompt(input: TTIPromptInput, context?: CompileContext): TTIPromptOutput {
    const manifest = input.visualManifest;
    const styleGuide = input.seasonStyleGuide || {};
    const seenNames = new Set<string>();
    const selectedCharacters = manifest.selectedCharacters
      .filter((character) => {
        const name = character.displayName.trim().toLowerCase();
        if (!name || TITLE_WORD_BLOCKLIST.has(name) || PRONOUN_BLOCKLIST.has(name)) {
          return false;
        }
        if (seenNames.has(name)) {
          return false;
        }
        seenNames.add(name);
        return true;
      })
      .map((character) => ({
        name: this.normalizePromptCharacterName(character.displayName),
        ageYears: character.ageYears,
        visual: this.ensureEmotionInPromptVisual(
          this.stripLeadingAgeClause(
            this.prepareVisualDescriptionForPrompt(
              this.normalizePromptCharacterName(character.displayName),
              character.visualDescription,
              character.roleInScene,
              character.ageYears,
            ),
            character.ageYears,
            character.roleInScene,
          ),
          {
            role: character.roleInScene,
            action: character.action,
            mood: manifest.mood,
            keyActionBeat: manifest.keyActionBeat,
          },
        ),
        count: 'exactly once',
        role: character.roleInScene,
        placement: character.placement,
        action: character.action,
      }));

    const leadHero = selectedCharacters.find((character) => character.role === 'main_hero');
    const characterSentences = selectedCharacters.map((character) => {
      const parts = [
        this.buildCharacterLead(character, leadHero?.name),
        character.visual,
      ].filter(Boolean);
      return parts.join(', ');
    });

    const styleParts = [
      styleGuide.colorMood,
      styleGuide.visualTone,
      'soft expressive faces',
      'magical lighting',
    ].filter(Boolean);

    const referenceImages = this.buildReferenceImages(input, manifest, context?.roster || []);
    const referenceSuffix = referenceImages.length
      ? 'same storybook style as the provided hero reference image'
      : 'polished 2D painted children\'s storybook illustration style';

    const intro =
      'Create an original polished 2D painted children\'s storybook illustration of one specific storybook moment.';
    const momentText = this.normalizeSceneBeatCharacterNames(
      this.sanitizeIpText(this.cleanText(input.moment)),
      manifest.selectedCharacters,
    );
    const heroLine = leadHero ? `${leadHero.name} is the central child hero in this scene.` : '';

    const bodyParts = [
      intro,
      momentText ? `${momentText}.` : '',
      heroLine,
      characterSentences.length ? `Character appearance: ${characterSentences.join('. ')}.` : '',
      styleParts.length ? `${styleParts.join(', ')}, ${referenceSuffix}.` : `${referenceSuffix}.`,
    ].filter(Boolean);

    let positivePrompt = bodyParts.join(' ').replace(/\s+/g, ' ').trim();
    if (positivePrompt.length > POSITIVE_PROMPT_MAX_CHARS) {
      positivePrompt = this.truncateAtSentence(positivePrompt, POSITIVE_PROMPT_MAX_CHARS);
    }

    const negativePrompt = this.buildNegativePrompt(input, manifest, context);

    return {
      selectedCharacters,
      props: [],
      environment: momentText || manifest.environment?.visualDescription || '',
      positivePrompt,
      negativePrompt,
      referenceImages,
    };
  }

  validateTTIPrompt(
    output: TTIPromptOutput,
    roster: SeasonCharacter[],
    manifest?: EpisodeVisualManifest,
  ): TTIPromptValidationResult {
    const issues: TTIPromptValidationIssue[] = [];
    const rosterByName = new Map<string, SeasonCharacter>();
    for (const character of roster) {
      for (const term of this.getSearchTerms(character)) {
        rosterByName.set(term.toLowerCase(), character);
      }
    }

    const selectedNames = output.selectedCharacters.map((item) => item.name.toLowerCase());
    const uniqueNames = new Set(selectedNames);
    if (uniqueNames.size !== selectedNames.length) {
      issues.push({
        code: 'duplicate_character',
        message: 'A selected character appears more than once in the prompt output.',
        severity: 'error',
      });
    }

    for (const name of selectedNames) {
      if (TITLE_WORD_BLOCKLIST.has(name) || PRONOUN_BLOCKLIST.has(name)) {
        issues.push({
          code: 'invalid_character_name',
          message: `Invalid character name in prompt: ${name}`,
          severity: 'error',
        });
      }
      if (!rosterByName.has(name) && !Array.from(rosterByName.keys()).some((term) => name.includes(term))) {
        issues.push({
          code: 'unknown_character',
          message: `Character "${name}" is not in the season roster.`,
          severity: 'warning',
        });
      }
    }

    if (manifest) {
      for (const prop of manifest.props) {
        for (const name of selectedNames) {
          if (prop.name.toLowerCase().includes(name) && !rosterByName.has(name)) {
            issues.push({
              code: 'prop_in_characters',
              message: `Prop "${prop.name}" overlaps with character list.`,
              severity: 'error',
            });
          }
        }
      }
    }

    for (const term of [...FRANCHISE_TERMS, ...COPYRIGHTED_CHARACTER_NAMES]) {
      if (output.positivePrompt.toLowerCase().includes(term)) {
        issues.push({
          code: 'franchise_term',
          message: `Prompt contains blocked franchise or copyrighted term: ${term}`,
          severity: 'error',
        });
      }
    }

    if (/\{|\}|"episodeTitle"|storage as an inline|data URL/i.test(output.positivePrompt)) {
      issues.push({
        code: 'raw_debug_text',
        message: 'Prompt contains raw JSON or internal debug text.',
        severity: 'error',
      });
    }

    if (!output.environment?.trim()) {
      issues.push({
        code: 'missing_environment',
        message: 'Prompt is missing environment description.',
        severity: 'error',
      });
    }

    if (output.positivePrompt.length > POSITIVE_PROMPT_MAX_CHARS) {
      issues.push({
        code: 'positive_too_long',
        message: `Positive prompt exceeds ${POSITIVE_PROMPT_MAX_CHARS} characters.`,
        severity: 'error',
      });
    }

    if (output.negativePrompt.length > NEGATIVE_PROMPT_MAX_CHARS) {
      issues.push({
        code: 'negative_too_long',
        message: `Negative prompt exceeds ${NEGATIVE_PROMPT_MAX_CHARS} characters.`,
        severity: 'error',
      });
    }

    const hasErrors = issues.some((issue) => issue.severity === 'error');
    let fixedPrompt: TTIPromptOutput | undefined;
    if (hasErrors) {
      fixedPrompt = this.autoFixPrompt(output, roster, manifest);
    }

    return {
      valid: !hasErrors,
      issues,
      fixedPrompt,
    };
  }

  buildFinalApiPrompt(output: TTIPromptOutput): string {
    return `${output.positivePrompt} Avoid: ${output.negativePrompt}`;
  }

  private buildNegativePrompt(
    input: TTIPromptInput,
    manifest: EpisodeVisualManifest,
    context?: CompileContext,
  ): string {
    const terms: string[] = [];
    const seen = new Set<string>();

    const addTerm = (term: string) => {
      const normalized = this.normalizeNegativeTerm(term);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      terms.push(normalized);
    };

    for (const term of GENERIC_NEGATIVE_PROMPT.split(',')) {
      addTerm(term);
    }

    for (const term of input.seasonStyleGuide?.avoid || []) {
      addTerm(term);
    }

    for (const boundary of context?.safetyBoundaries || []) {
      addTerm(boundary);
    }

    const selectedNames = new Set(
      manifest.selectedCharacters.map((character) => character.displayName.trim().toLowerCase()),
    );
    for (const character of context?.roster || []) {
      const isSelected = selectedNames.has(character.displayName.trim().toLowerCase());
      if (isSelected) {
        for (const item of character.doNotShow || []) {
          addTerm(item);
        }
      }
      if (character.duplicatePrevention) {
        addTerm(character.duplicatePrevention);
      }
    }

    return this.truncateText(terms.join(', '), NEGATIVE_PROMPT_MAX_CHARS);
  }

  private normalizeNegativeTerm(term: string): string {
    return this.cleanText(term)
      .replace(/^no\s+/i, '')
      .replace(/^avoid\s+/i, '')
      .replace(/^do not\s+(show|include|draw)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private autoFixPrompt(
    output: TTIPromptOutput,
    roster: SeasonCharacter[],
    manifest?: EpisodeVisualManifest,
  ): TTIPromptOutput {
    let positivePrompt = output.positivePrompt;
    for (const term of [...FRANCHISE_TERMS, ...COPYRIGHTED_CHARACTER_NAMES]) {
      positivePrompt = positivePrompt.replace(new RegExp(term, 'gi'), '');
    }
    positivePrompt = positivePrompt.replace(/\s+/g, ' ').trim();
    if (positivePrompt.length > POSITIVE_PROMPT_MAX_CHARS) {
      positivePrompt = this.truncateAtSentence(positivePrompt, POSITIVE_PROMPT_MAX_CHARS);
    }

    const seenNames = new Set<string>();
    const fixedCharacters = (manifest?.selectedCharacters || [])
      .filter((character) => {
        const name = character.displayName.trim().toLowerCase();
        if (!name || TITLE_WORD_BLOCKLIST.has(name) || PRONOUN_BLOCKLIST.has(name)) {
          return false;
        }
        if (seenNames.has(name)) {
          return false;
        }
        seenNames.add(name);
        return true;
      })
      .map((character) => ({
      name: character.displayName,
      visual: character.visualDescription,
      count: 'exactly once',
      role: character.roleInScene,
      placement: character.placement,
      action: character.action,
    }));

    return {
      ...output,
      selectedCharacters: fixedCharacters.length ? fixedCharacters : output.selectedCharacters,
      positivePrompt,
      negativePrompt: this.truncateText(output.negativePrompt, NEGATIVE_PROMPT_MAX_CHARS),
    };
  }

  private findRosterMatch(characters: SeasonCharacter[], sceneRef: SceneCharacterRef): SeasonCharacter | null {
    const candidates = this.uniqueStrings([sceneRef.name, ...(sceneRef.aliases || [])]);
    for (const candidate of candidates) {
      const exact = this.findCharacterInRoster(characters, candidate);
      if (exact) {
        return exact;
      }
    }

    const sceneName = sceneRef.name.trim().toLowerCase();
    if (!sceneName) {
      return null;
    }

    for (const character of characters) {
      for (const term of this.getSearchTerms(character)) {
        const normalized = term.toLowerCase();
        if (normalized.length < 3) {
          continue;
        }
        if (sceneName === normalized || sceneName.includes(normalized) || normalized.includes(sceneName)) {
          return character;
        }
      }
    }

    return null;
  }

  private findCharacterInRoster(characters: SeasonCharacter[], name: string): SeasonCharacter | null {
    const target = String(name || '').trim().toLowerCase();
    if (!target) {
      return null;
    }

    return (
      characters.find((character) =>
        this.getSearchTerms(character).some((term) => term.toLowerCase() === target),
      ) || null
    );
  }

  private deduplicateCharactersForScene(characters: SeasonCharacter[]): SeasonCharacter[] {
    const roleRank: Record<SeasonCharacter['role'], number> = {
      main_hero: 6,
      recurring_companion: 5,
      child_ally: 4,
      magical_helper: 3,
      mentor: 2,
      antagonist: 1,
      minor_character: 0,
    };
    const byKey = new Map<string, SeasonCharacter>();

    for (const character of characters) {
      const key = String(character.internalName || character.safeDisplayName || character.displayName)
        .trim()
        .toLowerCase();
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing || roleRank[character.role] > roleRank[existing.role]) {
        byKey.set(key, character);
      }
    }

    return Array.from(byKey.values());
  }

  private buildReferenceImages(
    input: TTIPromptInput,
    manifest: EpisodeVisualManifest,
    roster: SeasonCharacter[],
  ): TTIPromptOutput['referenceImages'] {
    const images: NonNullable<TTIPromptOutput['referenceImages']> = [];
    const heroRef = input.heroReferenceImageUrl || manifest.selectedCharacters.find((c) => c.referenceImageUrl)?.referenceImageUrl;
    if (heroRef && heroRef.startsWith('http')) {
      const hero = roster.find((item) => item.role === 'main_hero');
      images.push({
        characterId: hero?.characterId,
        url: heroRef,
        use: hero?.referenceUse || 'preserve identity, proportions, outfit, colors, and storybook style',
      });
    }
    return images;
  }

  private getSearchTerms(character: SeasonCharacter): string[] {
    return this.uniqueStrings([
      character.displayName,
      character.internalName || '',
      character.safeDisplayName || '',
      ...(character.aliases || []),
    ]);
  }

  private getPromptName(character: SeasonCharacter): string {
    return this.normalizePromptCharacterName(this.choosePromptBaseName(character));
  }

  private isCharacterMentionedInMoment(
    moment: string,
    sceneRef: SceneCharacterRef,
    roster: SeasonCharacter[],
  ): boolean {
    const normalizedMoment = moment.toLowerCase();
    if (!normalizedMoment) {
      return false;
    }

    const rosterMatch = this.findRosterMatch(roster, sceneRef);
    const terms = rosterMatch
      ? this.getSearchTerms(rosterMatch)
      : this.uniqueStrings([sceneRef.name, ...(sceneRef.aliases || [])]);

    const normalizedTerms = terms
      .map((term) => term.toLowerCase())
      .filter((term) => term.length >= 3 && !TITLE_WORD_BLOCKLIST.has(term) && !PRONOUN_BLOCKLIST.has(term));

    if (normalizedTerms.some((term) => this.containsWholeTerm(normalizedMoment, term))) {
      return true;
    }

    // Match possessive and compact alias forms (e.g. "Sigrid's", "Junior's").
    return normalizedTerms.some((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}(?:'s|s)?\\b`, 'i').test(normalizedMoment);
    });
  }

  private toManifestCharacter(
    character: SeasonCharacter,
  ): EpisodeVisualManifest['selectedCharacters'][number] {
    const displayName = this.getPromptName(character);
    return {
      characterId: character.characterId,
      displayName,
      safeDisplayName: character.safeDisplayName || undefined,
      aliases: character.aliases || undefined,
      ageYears: this.normalizeAgeYears(character.ageYears) ?? undefined,
      visualDescription: this.sanitizeIpText(character.visualDescription),
      roleInScene: character.role,
      referenceImageUrl: character.referenceImageUrl || undefined,
    };
  }

  private toManifestCharacterFromSceneRef(
    sceneRef: SceneCharacterRef,
    roster: SeasonCharacter[],
  ): EpisodeVisualManifest['selectedCharacters'][number] | null {
    const rosterMatch = this.findRosterMatch(roster, sceneRef);
    if (rosterMatch) {
      const base = this.toManifestCharacter(rosterMatch);
      const sceneVisual = this.sanitizeIpText(sceneRef.visualDescription || '');
      const resolvedSceneDisplayName = this.resolveSceneRefDisplayName(sceneRef);
      const shouldUseSceneDisplayName = Boolean(sceneRef.safeDisplayName);
      return {
        ...base,
        displayName: shouldUseSceneDisplayName ? resolvedSceneDisplayName || base.displayName : base.displayName,
        safeDisplayName: sceneRef.safeDisplayName || base.safeDisplayName,
        aliases: this.uniqueStrings([...(base.aliases || []), sceneRef.name, ...(sceneRef.aliases || [])]) || undefined,
        ageYears: this.normalizeAgeYears(sceneRef.ageYears) ?? base.ageYears,
        visualDescription: this.mergeSceneVisualIntoCanonical(base.visualDescription, sceneVisual),
        roleInScene: sceneRef.role || base.roleInScene,
      };
    }

    const displayName = this.resolveSceneRefDisplayName(sceneRef);
    const loweredName = displayName.toLowerCase();
    if (!displayName || TITLE_WORD_BLOCKLIST.has(loweredName) || PRONOUN_BLOCKLIST.has(loweredName)) {
      return null;
    }

    return {
      characterId: `scene-ref:${loweredName.replace(/[^a-z0-9]+/gi, '-')}`,
      displayName,
      safeDisplayName: displayName,
      aliases: this.uniqueStrings([sceneRef.name, ...(sceneRef.aliases || [])]) || undefined,
      ageYears: this.normalizeAgeYears(sceneRef.ageYears) ?? undefined,
      visualDescription: this.sanitizeIpText(
        sceneRef.visualDescription || `${displayName} appears clearly in the current scene`,
      ),
      roleInScene: sceneRef.role,
    };
  }

  private buildCharacterLead(
    character: TTIPromptOutput['selectedCharacters'][number],
    _leadHeroName?: string,
  ): string {
    const agePrefix = this.describeCharacterAge(character.ageYears, character.role);
    if (character.role === 'main_hero') {
      return [character.name, agePrefix, 'the central child hero'].filter(Boolean).join(', ');
    }
    if (character.role === 'magical_helper') {
      return [character.name, agePrefix, 'a magical helper'].filter(Boolean).join(', ');
    }
    return [character.name, agePrefix].filter(Boolean).join(', ');
  }

  private normalizePromptCharacterName(name: string): string {
    const cleaned = this.cleanText(name);
    const lowered = cleaned.toLowerCase();
    const override = COMPANION_SAFE_NAME_OVERRIDES[lowered];
    if (override?.safeName) {
      return override.safeName;
    }
    if (/swift black dragon junior/i.test(cleaned)) {
      return 'Midnight Junior';
    }
    return cleaned;
  }

  private normalizeSceneBeatCharacterNames(
    text: string,
    selectedCharacters?: EpisodeVisualManifest['selectedCharacters'],
  ): string {
    let normalized = text;

    for (const character of selectedCharacters || []) {
      const canonicalName = this.normalizePromptCharacterName(character.displayName);
      const aliases = this.uniqueStrings([
        character.displayName,
        character.safeDisplayName || '',
        ...(character.aliases || []),
      ]).sort((a, b) => b.length - a.length);

      for (const alias of aliases) {
        const cleanedAlias = this.cleanText(alias);
        if (!cleanedAlias || cleanedAlias.toLowerCase() === canonicalName.toLowerCase()) {
          continue;
        }
        if (canonicalName.toLowerCase().includes(cleanedAlias.toLowerCase())) {
          continue;
        }
        const escaped = cleanedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        normalized = normalized.replace(
          new RegExp(`\\b${escaped}('s)?\\b`, 'gi'),
          (_match, possessive: string | undefined) => `${canonicalName}${possessive || ''}`,
        );
      }
    }

    return normalized
      .replace(/\bToothless Junior\b/gi, 'Midnight Junior')
      .replace(/\ba swift black dragon Junior\b/gi, 'Midnight Junior')
      .replace(/\bblack dragon Junior\b/gi, 'Midnight Junior')
      .replace(/\bJunior\b/g, 'Midnight Junior')
      .replace(/\bMidnight\s+Midnight\s+Junior\b/gi, 'Midnight Junior')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private extractFallbackDisplayName(name: string): string {
    const cleaned = this.cleanText(name).replace(/[^\p{L}\p{N}' -]+/gu, ' ').trim();
    const firstWord = cleaned.split(/\s+/)[0] || cleaned;
    return this.cleanText(firstWord);
  }

  private resolveSceneRefDisplayName(sceneRef: SceneCharacterRef): string {
    const rawCandidates = [sceneRef.safeDisplayName || '', sceneRef.name, ...(sceneRef.aliases || [])];
    for (const rawCandidate of rawCandidates) {
      const candidate = this.cleanText(rawCandidate).toLowerCase();
      if (!candidate) {
        continue;
      }
      const override = COMPANION_SAFE_NAME_OVERRIDES[candidate];
      if (override?.safeName) {
        return override.safeName;
      }
    }

    return this.cleanText(
      sceneRef.safeDisplayName || sceneRef.name || sceneRef.aliases?.[0] || this.extractFallbackDisplayName(sceneRef.name),
    );
  }

  private choosePromptBaseName(character: SeasonCharacter): string {
    const safeName = this.cleanText(character.safeDisplayName || '');
    const displayName = this.cleanText(character.displayName || '');
    const internalName = this.cleanText(character.internalName || '');

    if (
      safeName &&
      internalName &&
      TtiPromptService.GENERIC_PROMPT_NAMES.has(safeName.toLowerCase()) &&
      internalName.toLowerCase() !== safeName.toLowerCase()
    ) {
      return internalName;
    }

    return safeName || displayName || internalName;
  }

  private containsWholeTerm(text: string, term: string): boolean {
    if (!term) return false;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  }

  private sanitizeIpText(text: string): string {
    let result = text;
    for (const term of [...FRANCHISE_TERMS, ...COPYRIGHTED_CHARACTER_NAMES]) {
      result = result.replace(new RegExp(term, 'gi'), '');
    }
    return result.replace(/\s+/g, ' ').trim();
  }

  private prepareVisualDescriptionForPrompt(
    characterName: string,
    visualDescription: string,
    role?: string,
    ageYears?: number,
  ): string {
    const normalizedName = this.normalizePromptCharacterName(characterName);
    let result = this.extractVisualPromptDetails(this.sanitizeIpText(visualDescription), role, ageYears);
    if (this.isWeakPromptVisual(result, role)) {
      result = this.buildPromptVisualFallback(normalizedName, role, result);
    }

    if (role === 'main_hero') {
      result = result
        .replace(/,?\s*with a small dragon perched on (?:her|his|their) shoulder or flying beside (?:her|his|their) head/gi, '')
        .replace(/,?\s*a small dragon perched on (?:her|his|their) shoulder or flying beside (?:her|his|their) head/gi, '');
    }

    if (normalizedName === 'Midnight Junior') {
      result = result.replace(/\bToothless Junior\b/gi, 'Midnight Junior');
      result = result.replace(/\ba swift black dragon Junior\b/gi, 'Midnight Junior');
    }

    return result
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,{2,}/g, ',')
      .replace(/\b(?:and|or|with|plus)\s*[,.]\s*$/i, '')
      .replace(/\b(?:and|or|with|plus|wearing|holding|carrying)\s*[.]?$/i, '')
      .replace(/(^,\s*|\s*,\s*$)/g, '')
      .trim();
  }

  private ensureEmotionInPromptVisual(
    visual: string,
    context: {
      role?: string;
      action?: string;
      mood?: string;
      keyActionBeat?: string;
    },
  ): string {
    const normalized = this.cleanText(visual);
    if (!normalized) {
      return this.inferFallbackEmotionClause(context);
    }

    if (this.hasEmotionCue(normalized)) {
      return normalized;
    }

    return [normalized, this.inferFallbackEmotionClause(context)].filter(Boolean).join(', ');
  }

  private hasEmotionCue(text: string): boolean {
    return /\b(expression|expressive|looks?|looking|facial|smile|smiling|frown|frowning|worried|worry|anxious|afraid|fearful|scared|startled|shocked|alarmed|tense|determined|focused|curious|hopeful|relieved|calm|gentle|sleepy|tired|sad|angry|serious|confident|wide-eyed|wide eyed)\b/i.test(
      text,
    );
  }

  private inferFallbackEmotionClause(context: {
    role?: string;
    action?: string;
    mood?: string;
    keyActionBeat?: string;
  }): string {
    const role = String(context.role || '').toLowerCase();
    const actionText = `${context.action || ''} ${context.keyActionBeat || ''}`.toLowerCase();
    const mood = String(context.mood || '').toLowerCase();

    if (/(asleep|sleeping|sleepy|resting|closed eyes)/i.test(actionText)) {
      return 'sleepy expression';
    }

    if (/(alarm|danger|fall|falling|collapse|collapsing|shake|shaking|rumble|rushing|runs? |running|unstable|mist|fog|threat|panic|urgent)/i.test(actionText) || /suspense|tense|worry|afraid/.test(mood)) {
      if (role === 'main_hero') {
        return 'worried but determined expression';
      }
      if (role === 'magical_helper') {
        return 'alert worried expression';
      }
      return 'tense worried expression';
    }

    if (/(study|carefully|guide|holding up|light the path|reaching|reaches|protect)/i.test(actionText)) {
      if (role === 'main_hero') {
        return 'focused determined expression';
      }
      return 'focused expression';
    }

    if (/hopeful|cooperative|warm/.test(mood)) {
      return role === 'main_hero' ? 'hopeful curious expression' : 'hopeful expression';
    }

    return role === 'main_hero' ? 'curious determined expression' : 'attentive expression';
  }

  private cleanText(text: string): string {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
  }

  private truncateAtSentence(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const slice = text.slice(0, maxChars);
    const lastPeriod = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
    if (lastPeriod > maxChars * 0.6) {
      return slice.slice(0, lastPeriod + 1).trim();
    }
    return `${slice.trim()}...`;
  }

  private uniqueStrings(items: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
      const value = item.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  private describeCharacterAge(ageYears?: number, role?: string): string | null {
    const normalizedAge = this.normalizeAgeYears(ageYears);
    if (normalizedAge === null) {
      return null;
    }
    if (role && /main_hero|recurring_companion|child_ally|mentor|minor_character/.test(role)) {
      return `${normalizedAge}-year-old`;
    }
    return null;
  }

  private extractVisualPromptDetails(text: string, role?: string, ageYears?: number): string {
    const normalized = this.cleanText(text);
    if (!normalized) {
      return this.describeCharacterAge(ageYears, role) || '';
    }

    const clauses = normalized
      .split(/(?<=[.!?])\s+|,\s+(?=(?:with|wearing|in |her |his |their |now |eyes |face |small |tall |short |older |young |glowing |holding |resting |sleeping |asleep))/i)
      .map((part) =>
        this.cleanText(
          part.replace(
            /\bwho\s+(?:knows|speaks|understands|believes|wants|tries|decides|learns|teaches)\b.*$/i,
            '',
          ),
        ),
      )
      .filter(Boolean);

    const visualKeyword =
      /\b(year-old|young|older|child|girl|boy|woman|man|dragon|sprite|animal|hair|braid|eyes|face|cloak|tunic|dress|coat|boots|belt|hood|scales|wings|fur|tail|lantern|crystal|necklace|pouch|staff|glow|glowing|blue|green|gold|silver|black|brown|red|white|gray|grey|smile|frown|worried|calm|angry|sleep|asleep|closed|slumped|kneeling|standing|holding|resting|hovering)\b/i;
    const nonVisualKeyword =
      /\b(knows|speaks|understands|believes|wants|tries|decides|learns|teaches|authority|stories|old stories|memory|remembers|quiet|observant|wise|foil|teacher|best friend)\b/i;

    const kept = clauses.filter((clause) => visualKeyword.test(clause) && !nonVisualKeyword.test(clause));
    const compact = this.uniqueStrings(
      (kept.length ? kept : clauses.filter((clause) => visualKeyword.test(clause))).map((clause) => this.cleanText(clause)),
    ).join(', ');
    const agePrefix = this.describeCharacterAge(ageYears, role);

    const withoutDuplicateAge =
      agePrefix && compact.toLowerCase().includes(agePrefix.toLowerCase())
        ? compact
        : [agePrefix, compact].filter(Boolean).join(', ');

    return this.normalizeCanonicalVisualDescription(withoutDuplicateAge)
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,?\s*\b(?:and|or|with|plus)\s*$/i, '')
      .trim();
  }

  private stripLeadingAgeClause(text: string, ageYears?: number, role?: string): string {
    const agePrefix = this.describeCharacterAge(ageYears, role);
    if (!agePrefix) {
      return text;
    }

    return text.replace(new RegExp(`^${agePrefix.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*,\\s*`, 'i'), '');
  }

  private isWeakPromptVisual(text: string, role?: string): boolean {
    const normalized = this.cleanText(text);
    if (!normalized) {
      return true;
    }

    if (/^\d{1,3}-year-old$/i.test(normalized)) {
      return true;
    }

    const strongVisualKeyword =
      /\b(hair|braid|eyes|face|cloak|hood|tunic|dress|coat|boots|belt|scales|wings|fur|tail|horns|lantern|crystal|necklace|bracelet|pouch|staff|blue|green|gold|silver|black|brown|red|white|gray|grey|freckles)\b/i;
    return !strongVisualKeyword.test(normalized);
  }

  private buildPromptVisualFallback(characterName: string, role?: string, currentText?: string): string {
    const key = this.extractFallbackDisplayName(characterName).toLowerCase();
    const known = KNOWN_ALLY_DEFAULTS[key]?.visual;
    if (known) {
      return known;
    }
    if (role === 'recurring_companion' || role === 'child_ally') {
      return 'young child companion with a clear face, simple outfit, and readable silhouette';
    }
    if (role === 'magical_helper') {
      return 'small magical creature with a clear silhouette, expressive eyes, and child-safe design';
    }
    return currentText || '';
  }

  private normalizeCanonicalVisualDescription(text: string): string {
    if (!text) {
      return '';
    }

    return text
      .replace(/\b(?:often|sometimes|usually|may|can)\s+(carry|wear|hold|have)\b/gi, '$1')
      .replace(
        /\b(carries|wears|holds|has)\s+([^,.]+?)\s+or\s+([^,.]+?)(?=(?:,|\.|$))/gi,
        '$1 $2',
      )
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,{2,}/g, ',')
      .replace(/(^,\s*|\s*,\s*$)/g, '')
      .trim();
  }

  private mergeSceneVisualIntoCanonical(canonical: string, sceneVisual: string): string {
    const base = this.cleanText(canonical || '');
    const scene = this.cleanText(sceneVisual || '');
    if (!scene) {
      return base;
    }

    const overlays = this.extractSceneStateClauses(scene);
    if (!overlays.length) {
      return base;
    }

    return this.uniqueStrings([base, ...overlays]).join(', ');
  }

  private extractSceneStateClauses(text: string): string[] {
    const clauses = this.cleanText(text)
      .split(/(?<=[.!?])\s+|,\s+/)
      .map((clause) => this.cleanText(clause))
      .filter(Boolean);

    const stateKeyword =
      /\b(now|currently|today|wet|muddy|dusty|dirty|sooty|soot|torn|damp|streaked|scuffed|asleep|sleeping|sleepy|closed|slumped|kneeling|crouching|shivering|worried|relieved|smiling|frowning|holding|clutching|reaching|pointing|resting|hovering|glowing|raised)\b/i;

    return this.uniqueStrings(
      clauses
        .filter((clause) => stateKeyword.test(clause))
        .map((clause) =>
          clause
            .replace(/\b(light|dark|pale|deep)\s*-\s*(brown|blue|green|red|gold|silver|black|white|grey|gray)\b/gi, '$2')
            .replace(/\b(light|dark|pale|deep)\s+(brown|blue|green|red|gold|silver|black|white|grey|gray)\b/gi, '$2')
            .trim(),
        ),
    );
  }

  private normalizeAgeYears(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) {
      return null;
    }
    const rounded = Math.round(normalized);
    if (rounded <= 0 || rounded > 120) {
      return null;
    }
    return rounded;
  }
}
