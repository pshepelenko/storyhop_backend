import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Hero } from '../entities/hero.entity';
import { SeasonCharacter, SeasonCharacterRole } from '../entities/season-character.entity';
import {
  COMPANION_SAFE_NAME_OVERRIDES,
  COPYRIGHTED_CHARACTER_NAMES,
  KNOWN_ALLY_DEFAULTS,
  PRONOUN_BLOCKLIST,
  TITLE_WORD_BLOCKLIST,
} from './tti-prompt.constants';

type UpsertSeasonCharacterInput = Partial<SeasonCharacter> & {
  displayName: string;
  role: SeasonCharacterRole;
  type: string;
  visualDescription: string;
};

type BibleCharacterInput = {
  name?: string;
  role?: string;
  ageYears?: number;
  personality?: string;
  relationshipToHero?: string;
  type?: string;
  visualDescription?: string;
};

type EpisodeSceneCharacterInput = {
  name?: string;
  role?: string;
  type?: string;
  ageYears?: number;
  visualDescription?: string;
  aliases?: string[];
  safeDisplayName?: string;
};

@Injectable()
export class SeasonCharactersService {
  constructor(
    @InjectRepository(SeasonCharacter)
    private readonly seasonCharactersRepository: Repository<SeasonCharacter>,
  ) {}

  async listBySeason(seasonId: string): Promise<SeasonCharacter[]> {
    const characters = await this.seasonCharactersRepository.find({
      where: { seasonId },
      order: { createdAt: 'ASC' },
    });
    return this.deduplicateRoster(characters);
  }

  deduplicateRoster(characters: SeasonCharacter[]): SeasonCharacter[] {
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
      const identityName = String(character.internalName || character.safeDisplayName || character.displayName || '').trim();
      if (!this.isValidCharacterName(identityName)) {
        continue;
      }

      const key = identityName.toLowerCase();
      const existing = byKey.get(key);
      if (!existing || roleRank[character.role] > roleRank[existing.role]) {
        byKey.set(key, character);
      }
    }

    return Array.from(byKey.values());
  }

  async upsertCharacter(seasonId: string, input: UpsertSeasonCharacterInput): Promise<SeasonCharacter> {
    const now = new Date();
    const characterId = input.characterId || uuidv4();
    const existing = await this.seasonCharactersRepository.findOne({ where: { characterId } });
    const record = this.seasonCharactersRepository.create({
      characterId,
      seasonId,
      displayName: input.displayName,
      internalName: input.internalName || null,
      safeDisplayName: input.safeDisplayName || null,
      aliases: input.aliases || [],
      role: input.role,
      type: input.type,
      ageYears: input.ageYears ?? null,
      visualDescription: input.visualDescription,
      mainColors: input.mainColors || [],
      silhouette: input.silhouette || null,
      signatureItems: input.signatureItems || [],
      personalityVisualCues: input.personalityVisualCues || null,
      allowedVariations: input.allowedVariations || [],
      doNotShow: input.doNotShow || [],
      countRule: input.countRule || 'exactly_one_when_selected',
      duplicatePrevention: input.duplicatePrevention || null,
      placementPreference: input.placementPreference || null,
      referenceImageUrl: input.referenceImageUrl || null,
      referenceUse: input.referenceUse || null,
      needsReview: input.needsReview ?? false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    return this.seasonCharactersRepository.save(record);
  }

  async ensureSeasonRoster(
    seasonId: string,
    hero: Hero,
    seasonBible: Record<string, any>,
  ): Promise<SeasonCharacter[]> {
    return this.syncFromSeasonBible(seasonId, seasonBible, hero);
  }

  async syncFromSeasonBible(
    seasonId: string,
    seasonBible: Record<string, any>,
    hero?: Hero | null,
  ): Promise<SeasonCharacter[]> {
    const roster = await this.listBySeason(seasonId);
    const pending: SeasonCharacter[] = [...roster];

    if (hero) {
      this.mergeHeroCharacter(seasonId, hero, pending);
      this.mergeCompanionCharacter(seasonId, hero, pending);
    }

    for (const bibleCharacter of seasonBible?.mainCharacters || []) {
      this.mergeSourceCharacter(seasonId, pending, this.normalizeBibleCharacter(bibleCharacter), 'season_bible');
    }

    return this.saveNewCharacters(roster, pending);
  }

  async syncFromEpisodeContent(
    seasonId: string,
    episodeContent: Record<string, any>,
    hero?: Hero | null,
  ): Promise<SeasonCharacter[]> {
    const roster = await this.listBySeason(seasonId);
    const pending: SeasonCharacter[] = [...roster];

    for (const sceneCharacter of episodeContent?.sceneCharacters || []) {
      this.mergeSourceCharacter(seasonId, pending, this.normalizeSceneCharacter(sceneCharacter), 'episode');
    }

    if (hero) {
      this.mergeHeroCharacter(seasonId, hero, pending);
      this.mergeCompanionCharacter(seasonId, hero, pending);
    }

    return this.saveNewCharacters(roster, pending);
  }

  async canonicalizeSceneCharacters(
    seasonId: string,
    sceneCharacters: Array<Record<string, any>>,
  ): Promise<Array<Record<string, any>>> {
    if (!Array.isArray(sceneCharacters) || sceneCharacters.length === 0) {
      return [];
    }

    const roster = await this.listBySeason(seasonId);
    return sceneCharacters.map((sceneCharacter) => {
      const normalized = this.normalizeSceneCharacter(sceneCharacter || {});
      const displayName = normalized.safeDisplayName || this.extractPrimaryName(normalized.name);
      const existing =
        this.findCharacterInRoster(roster, normalized.name) ||
        this.findCharacterInRoster(roster, displayName) ||
        normalized.aliases.map((alias) => this.findCharacterInRoster(roster, alias)).find(Boolean);

      if (!existing) {
        return {
          ...sceneCharacter,
          name: normalized.name || sceneCharacter?.name || '',
          safeDisplayName: normalized.safeDisplayName,
          aliases: normalized.aliases,
          ageYears: this.normalizeAgeYears(normalized.ageYears) ?? undefined,
          visualDescription: normalized.visualDescription,
        };
      }

      return {
        ...sceneCharacter,
        name: existing.internalName || existing.displayName,
        safeDisplayName: existing.safeDisplayName || existing.displayName,
        aliases: this.uniqueStrings([
          ...(existing.aliases || []),
          normalized.name,
          ...(normalized.aliases || []),
        ]),
        role: sceneCharacter?.role || existing.role,
        type: sceneCharacter?.type || existing.type,
        ageYears: this.normalizeAgeYears(sceneCharacter?.ageYears) ?? existing.ageYears ?? undefined,
        visualDescription: this.mergeCanonicalVisualDescription(
          existing.visualDescription,
          normalized.visualDescription,
        ),
      };
    });
  }

  async backfillFromSeason(
    seasonId: string,
    hero: Hero,
    seasonBible: Record<string, any>,
  ): Promise<SeasonCharacter[]> {
    return this.syncFromSeasonBible(seasonId, seasonBible, hero);
  }

  private async saveNewCharacters(before: SeasonCharacter[], after: SeasonCharacter[]): Promise<SeasonCharacter[]> {
    const toSave = after.filter((item) => {
      const original = before.find((entry) => entry.characterId === item.characterId);
      if (!original) return true;
      return item.updatedAt.getTime() > original.updatedAt.getTime();
    });

    if (toSave.length) {
      await this.seasonCharactersRepository.save(toSave);
    }

    const seasonId = after[0]?.seasonId || before[0]?.seasonId;
    if (!seasonId) {
      return after;
    }
    return this.listBySeason(seasonId);
  }

  private mergeHeroCharacter(seasonId: string, hero: Hero, roster: SeasonCharacter[]) {
    const heroProfile = hero.heroProfile || {};
    const visualBrief = hero.heroVisualBrief || {};
    const heroAgeYears = this.normalizeAgeYears(heroProfile.ageYears);
    const rawHeroName = String(heroProfile.name || heroProfile.preferredName || 'Hero').trim();
    const heroDisplayName = this.extractPrimaryName(rawHeroName);
    const existing = this.findCharacterInRoster(roster, rawHeroName) || this.findCharacterInRoster(roster, heroDisplayName);

    if (existing) {
      this.patchCharacter(existing, {
        displayName: heroDisplayName,
        internalName: rawHeroName,
        safeDisplayName: heroDisplayName,
        aliases: this.uniqueStrings([...(existing.aliases || []), rawHeroName, heroDisplayName]),
        role: 'main_hero',
        type: String(visualBrief.speciesOrType || heroProfile.heroType || existing.type || 'human child'),
        ageYears: heroAgeYears ?? existing.ageYears,
        visualDescription: this.buildHeroVisualDescription(visualBrief, heroProfile),
        mainColors: Array.isArray(visualBrief.mainColors) ? visualBrief.mainColors : existing.mainColors,
        silhouette: visualBrief.silhouette || existing.silhouette,
        signatureItems: this.extractSignatureItems(visualBrief),
        doNotShow: Array.isArray(visualBrief.doNotShow) ? visualBrief.doNotShow : existing.doNotShow,
        referenceImageUrl: this.isHttpUrl(hero.heroReferenceImageUrl)
          ? hero.heroReferenceImageUrl
          : existing.referenceImageUrl,
        referenceUse: existing.referenceUse || 'preserve identity, proportions, outfit, colors, and storybook style',
        needsReview: existing.needsReview,
      });
      return;
    }

    roster.push(
      this.seasonCharactersRepository.create({
        characterId: uuidv4(),
        seasonId,
        displayName: heroDisplayName,
        internalName: rawHeroName,
        safeDisplayName: heroDisplayName,
        aliases: this.uniqueStrings([rawHeroName, heroDisplayName]),
        role: 'main_hero',
        type: String(visualBrief.speciesOrType || heroProfile.heroType || 'human child'),
        ageYears: heroAgeYears,
        visualDescription: this.buildHeroVisualDescription(visualBrief, heroProfile),
        mainColors: Array.isArray(visualBrief.mainColors) ? visualBrief.mainColors : [],
        silhouette: visualBrief.silhouette || null,
        signatureItems: this.extractSignatureItems(visualBrief),
        doNotShow: Array.isArray(visualBrief.doNotShow) ? visualBrief.doNotShow : [],
        countRule: 'exactly_one_when_selected',
        referenceImageUrl: this.isHttpUrl(hero.heroReferenceImageUrl) ? hero.heroReferenceImageUrl : null,
        referenceUse: 'preserve identity, proportions, outfit, colors, and storybook style',
        needsReview: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  }

  private mergeCompanionCharacter(seasonId: string, hero: Hero, roster: SeasonCharacter[]) {
    const companion = hero.heroProfile?.companion;
    if (!companion || typeof companion !== 'object' || !companion.name) {
      return;
    }

    const companionName = String(companion.name).trim();
    const override = COMPANION_SAFE_NAME_OVERRIDES[companionName.toLowerCase()];
    const displayName = override?.safeName || this.extractPrimaryName(companionName);
    const companionAgeYears = this.normalizeAgeYears(companion.ageYears);
    const existing = this.findCharacterInRoster(roster, companionName) || this.findCharacterInRoster(roster, displayName);

    if (existing) {
      this.patchCharacter(existing, {
        displayName,
        internalName: companionName,
        safeDisplayName: displayName,
        aliases: this.uniqueStrings([...(existing.aliases || []), companionName, displayName]),
        role: 'recurring_companion',
        type: String(companion.type || existing.type || 'companion'),
        ageYears: companionAgeYears ?? existing.ageYears,
        visualDescription: override?.visual || this.buildCompanionVisualDescription(companion),
        duplicatePrevention:
          existing.duplicatePrevention ||
          this.buildDuplicatePreventionRule(displayName, String(companion.type || existing.type || 'companion')),
        needsReview: existing.needsReview,
      });
      return;
    }

    roster.push(
      this.seasonCharactersRepository.create({
        characterId: uuidv4(),
        seasonId,
        displayName,
        internalName: companionName,
        safeDisplayName: displayName,
        aliases: this.uniqueStrings([companionName, displayName]),
        role: 'recurring_companion',
        type: String(companion.type || 'companion'),
        ageYears: companionAgeYears,
        visualDescription: override?.visual || this.buildCompanionVisualDescription(companion),
        countRule: 'exactly_one_when_selected',
        duplicatePrevention: this.buildDuplicatePreventionRule(
          displayName,
          String(companion.type || 'companion'),
        ),
        needsReview: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  }

  private mergeSourceCharacter(
    seasonId: string,
    roster: SeasonCharacter[],
    source: {
      name: string;
      role: SeasonCharacterRole;
      type: string;
      ageYears?: number | null;
      visualDescription: string;
      aliases: string[];
      safeDisplayName?: string;
    },
    origin: 'season_bible' | 'episode',
  ) {
    if (!this.isValidCharacterName(source.name)) {
      return;
    }

    const displayName = source.safeDisplayName || this.extractPrimaryName(source.name);
    const existing =
      this.findCharacterInRoster(roster, source.name) ||
      this.findCharacterInRoster(roster, displayName) ||
      source.aliases.map((alias) => this.findCharacterInRoster(roster, alias)).find(Boolean);
    const canonicalVisualDescription =
      origin === 'episode'
        ? this.extractStableVisualCore(source.visualDescription)
        : this.normalizeCanonicalVisualDescription(source.visualDescription);

    if (existing) {
      const shouldRefreshDescription =
        Boolean(canonicalVisualDescription) &&
        (
          !existing.visualDescription ||
          (existing.needsReview && origin === 'season_bible') ||
          (origin === 'episode' &&
            this.isVisualDescriptionLowSignal(existing.visualDescription) &&
            !this.isVisualDescriptionLowSignal(canonicalVisualDescription))
        );
      this.patchCharacter(existing, {
        displayName: existing.displayName || displayName,
        internalName: existing.internalName || source.name,
        safeDisplayName: source.safeDisplayName || existing.safeDisplayName || displayName,
        aliases: this.uniqueStrings([...(existing.aliases || []), source.name, displayName, ...source.aliases]),
        role: existing.role === 'main_hero' ? existing.role : source.role,
        type: source.type || existing.type,
        ageYears: this.normalizeAgeYears(source.ageYears) ?? existing.ageYears,
        visualDescription:
          shouldRefreshDescription && canonicalVisualDescription
            ? canonicalVisualDescription
            : existing.visualDescription,
        needsReview: existing.needsReview,
      });
      return;
    }

    roster.push(
      this.seasonCharactersRepository.create({
        characterId: uuidv4(),
        seasonId,
        displayName,
        internalName: source.name,
        safeDisplayName: source.safeDisplayName || displayName,
        aliases: this.uniqueStrings([source.name, displayName, ...source.aliases]),
        role: source.role,
        type: source.type,
        ageYears: this.normalizeAgeYears(source.ageYears),
        visualDescription: canonicalVisualDescription || source.visualDescription,
        countRule: 'exactly_one_when_selected',
        needsReview: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  }

  private normalizeBibleCharacter(bibleCharacter: BibleCharacterInput) {
    const name = String(bibleCharacter?.name || '').trim();
    const key = name.toLowerCase();
    const primaryKey = this.extractPrimaryName(name).toLowerCase();
    const known = KNOWN_ALLY_DEFAULTS[key] || KNOWN_ALLY_DEFAULTS[primaryKey];
    const override = COMPANION_SAFE_NAME_OVERRIDES[key] || COMPANION_SAFE_NAME_OVERRIDES[primaryKey];
    return {
      name,
      role: this.mapBibleRole(String(bibleCharacter.role || known?.role || 'minor_character')),
      type: bibleCharacter.type || known?.type || 'story character',
      ageYears: this.normalizeAgeYears(bibleCharacter.ageYears),
      visualDescription:
        bibleCharacter.visualDescription ||
        known?.visual ||
        override?.visual ||
        String(bibleCharacter.personality || name),
      aliases: this.uniqueStrings([name]),
      safeDisplayName: known?.safeName || override?.safeName || this.extractPrimaryName(name),
    };
  }

  private normalizeSceneCharacter(sceneCharacter: EpisodeSceneCharacterInput) {
    const name = String(sceneCharacter?.name || '').trim();
    const key = name.toLowerCase();
    const primaryKey = this.extractPrimaryName(name).toLowerCase();
    const known = KNOWN_ALLY_DEFAULTS[key] || KNOWN_ALLY_DEFAULTS[primaryKey];
    const override = COMPANION_SAFE_NAME_OVERRIDES[key] || COMPANION_SAFE_NAME_OVERRIDES[primaryKey];
    return {
      name,
      role: this.mapBibleRole(String(sceneCharacter.role || known?.role || 'minor_character')),
      type: sceneCharacter.type || known?.type || 'story character',
      ageYears: this.normalizeAgeYears(sceneCharacter.ageYears),
      visualDescription:
        sceneCharacter.visualDescription ||
        known?.visual ||
        override?.visual ||
        `${this.extractPrimaryName(name)} appearing in the episode scene`,
      aliases: this.uniqueStrings([name, ...(sceneCharacter.aliases || [])]),
      safeDisplayName:
        sceneCharacter.safeDisplayName || known?.safeName || override?.safeName || this.extractPrimaryName(name),
    };
  }

  private patchCharacter(character: SeasonCharacter, patch: Partial<SeasonCharacter>) {
    Object.assign(character, patch, { updatedAt: new Date() });
  }

  private findCharacterInRoster(roster: SeasonCharacter[], name: string): SeasonCharacter | null {
    const target = String(name || '').trim().toLowerCase();
    if (!target) return null;

    return (
      roster.find((character) =>
        [character.displayName, character.internalName, character.safeDisplayName, ...(character.aliases || [])]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase() === target),
      ) || null
    );
  }

  private isValidCharacterName(name: string): boolean {
    const trimmed = String(name || '').trim();
    if (!trimmed || trimmed.length < 2) return false;

    const parts = trimmed.split(/\s+/).map((part) => part.toLowerCase());
    if (parts.length >= 2 && ['the', 'a', 'an'].includes(parts[0])) {
      return false;
    }

    if (parts.every((part) => TITLE_WORD_BLOCKLIST.has(part) || PRONOUN_BLOCKLIST.has(part))) {
      return false;
    }

    const primary = parts[0];
    if (PRONOUN_BLOCKLIST.has(primary)) return false;
    if (TITLE_WORD_BLOCKLIST.has(primary)) return false;
    if (COPYRIGHTED_CHARACTER_NAMES.includes(primary)) return false;

    return /^\p{L}[\p{L}\p{N}'-]*(?:\s+\p{L}[\p{L}\p{N}'-]*)*$/u.test(trimmed);
  }

  private buildHeroVisualDescription(visualBrief: Record<string, any>, heroProfile: Record<string, any>): string {
    const parts = [
      visualBrief.hairFurOrSurface,
      visualBrief.outfit,
      visualBrief.silhouette,
      Array.isArray(visualBrief.consistencyNotes) ? visualBrief.consistencyNotes.join(', ') : '',
      heroProfile.signatureItem ? `signature item: ${heroProfile.signatureItem}` : '',
    ].filter(Boolean);
    const description = parts.join(', ').replace(/\s+/g, ' ').trim();
    return (
      this.normalizeCanonicalVisualDescription(this.removeCompanionMentionsFromHeroDescription(description)) ||
      'young child hero in a consistent storybook outfit'
    );
  }

  private buildDuplicatePreventionRule(displayName: string, type: string): string {
    const safeName = displayName.trim() || 'companion';
    const safeType = type.trim() || 'companion';
    return `Do not show a duplicate ${safeName} or a second ${safeType} in the same scene`;
  }

  private buildCompanionVisualDescription(companion: Record<string, any>): string {
    const type = String(companion.type || 'companion');
    const personality = String(companion.personality || 'friendly');
    return `a ${type}, ${personality}`;
  }

  private extractSignatureItems(visualBrief: Record<string, any>): string[] {
    const items: string[] = [];
    if (Array.isArray(visualBrief.consistencyNotes)) {
      for (const note of visualBrief.consistencyNotes) {
        if (/crystal|necklace|cape|cloak|lantern/i.test(String(note))) {
          items.push(String(note));
        }
      }
    }
    return items;
  }

  private mapBibleRole(role: string): SeasonCharacterRole {
    const normalized = role.toLowerCase();
    if (normalized.includes('hero')) return 'main_hero';
    if (normalized.includes('companion')) return 'recurring_companion';
    if (normalized.includes('mentor')) return 'mentor';
    if (normalized.includes('helper') || normalized.includes('magical')) return 'magical_helper';
    if (normalized.includes('ally') || normalized.includes('friend')) return 'child_ally';
    if (normalized.includes('antagonist') || normalized.includes('obstacle')) return 'antagonist';
    return 'minor_character';
  }

  private extractPrimaryName(name: string): string {
    return name.split(/\s+/)[0] || name;
  }

  private normalizeAgeYears(value: unknown): number | null {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) {
      return null;
    }
    const rounded = Math.round(normalized);
    if (rounded < 0 || rounded > 120) {
      return null;
    }
    return rounded;
  }

  private removeCompanionMentionsFromHeroDescription(text: string): string {
    if (!text) {
      return '';
    }

    const cleaned = text
      .replace(/,?\s*with a small dragon perched on (?:her|his|their) shoulder or flying beside (?:her|his|their) head/gi, '')
      .replace(/,?\s*a small dragon perched on (?:her|his|their) shoulder or flying beside (?:her|his|their) head/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,{2,}/g, ',')
      .trim();

    return cleaned.replace(/(^,\s*|\s*,\s*$)/g, '');
  }

  private normalizeCanonicalVisualDescription(text: string): string {
    if (!text) {
      return '';
    }

    return text
      .replace(/\b(?:often|sometimes|usually|may|can)\s+(carry|wear|hold|have)\b/gi, '$1')
      .replace(/\bsignature item:\s*([^,.]+?)\s+or\s+([^,.]+?)(?=(?:,|\.|$))/gi, 'signature item: $1')
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

  private isVisualDescriptionLowSignal(text: string): boolean {
    const normalized = this.cleanText(text);
    if (!normalized) {
      return true;
    }

    const visualKeyword =
      /\b(hair|braid|eyes|face|cloak|hood|tunic|dress|coat|boots|belt|scales|wings|fur|tail|horns|lantern|crystal|necklace|bracelet|pouch|staff|glow|glowing|blue|green|gold|silver|black|brown|red|white|gray|grey|freckles|small|tall|young|old|dragon|child|girl|boy|woman|man)\b/i;
    const biographyKeyword =
      /\b(quiet|observant|wise|kind|brave|curious|authority|tries|understand|before acting|stories|teacher|mentor|best friend|foil)\b/i;

    return !visualKeyword.test(normalized) || biographyKeyword.test(normalized);
  }

  private mergeCanonicalVisualDescription(canonical: string, sceneVisual: string): string {
    const base = this.normalizeCanonicalVisualDescription(canonical || '');
    const scene = this.cleanText(sceneVisual || '');
    if (!scene) {
      return base;
    }

    const overlays = this.extractSceneStateClauses(scene);
    if (!overlays.length) {
      return base;
    }

    return this.uniqueStrings([base, ...overlays])
      .join(', ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,{2,}/g, ',')
      .trim();
  }

  private extractStableVisualCore(text: string): string {
    const clauses = this.cleanText(text)
      .split(/(?<=[.!?])\s+|,\s+/)
      .map((clause) => this.cleanText(clause))
      .filter(Boolean);

    const stableVisualKeyword =
      /\b(hair|braid|eyes|face|cloak|hood|tunic|dress|coat|boots|belt|scales|wings|fur|tail|horns|lantern|crystal|necklace|bracelet|pouch|staff|blue|green|gold|silver|black|brown|red|white|gray|grey|freckles|small|large|huge|young|old|dragon|child|girl|boy|woman|man)\b/i;

    const stableClauses = this.uniqueStrings(
      clauses
        .map((clause) => this.removeSceneStateWords(clause))
        .map((clause) => this.cleanText(clause))
        .filter((clause) => stableVisualKeyword.test(clause)),
    );

    return this.normalizeCanonicalVisualDescription(stableClauses.join(', ')) || this.normalizeCanonicalVisualDescription(text);
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

  private isSceneStateClause(clause: string): boolean {
    return /\b(now|currently|today|wet|muddy|dusty|dirty|sooty|soot|torn|damp|streaked|scuffed|asleep|sleeping|sleepy|closed|slumped|kneeling|crouching|shivering|worried|relieved|smiling|frowning|holding|clutching|reaching|pointing|resting|hovering|floating|glowing|raised|foggy|mist|misty|breathing out|poured|pouring|running|ran|waking|woke)\b/i.test(
      clause,
    );
  }

  private removeSceneStateWords(clause: string): string {
    return clause
      .replace(/\b(now|currently|today|asleep|sleeping|sleepy|slumped|kneeling|crouching|shivering|worried|relieved|smiling|frowning|holding|clutching|reaching|pointing|resting|hovering|floating|glowing|raised|misty)\b/gi, '')
      .replace(/\b(closed eyes?|half-closed eyes?|one eye open|half-woken)\b/gi, '')
      .replace(/\b(breathing out|poured|pouring|wrapped in|covered in)\s+[^,.]+/gi, '')
      .replace(/\b(curled in|standing in|lying on|waking on|running toward)\s+[^,.]+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,{2,}/g, ',')
      .replace(/(^,\s*|\s*,\s*$)/g, '')
      .trim();
  }

  private cleanText(text: string): string {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  private isHttpUrl(value: string | null | undefined): boolean {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
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
}
