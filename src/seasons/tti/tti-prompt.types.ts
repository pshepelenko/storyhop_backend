import { SeasonCharacter } from '../entities/season-character.entity';

export type EpisodeVisualManifest = {
  episodeId?: string;
  seasonId: string;
  selectedCharacterIds: string[];
  selectedCharacters: Array<{
    characterId: string;
    displayName: string;
    safeDisplayName?: string;
    aliases?: string[];
    ageYears?: number;
    visualDescription: string;
    roleInScene?: string;
    placement?: string;
    action?: string;
    referenceImageUrl?: string;
  }>;
  props: Array<{
    id?: string;
    name: string;
    visualDescription?: string;
    roleInScene?: string;
  }>;
  environment?: {
    name?: string;
    visualDescription: string;
  };
  visualEffects?: string[];
  mood?: string;
  keyActionBeat?: string;
};

export type TTIPromptInput = {
  episodeTitle: string;
  episodeNumber: number;
  moment: string;
  chapterExcerpt?: string;
  seasonStyleGuide?: {
    visualTone?: string;
    colorMood?: string;
    avoid?: string[];
  };
  heroReferenceImageUrl?: string;
  visualManifest: EpisodeVisualManifest;
};

export type TTIPromptOutput = {
  selectedCharacters: Array<{
    name: string;
    ageYears?: number;
    visual: string;
    count: string;
    role?: string;
    placement?: string;
    action?: string;
  }>;
  props: string[];
  environment: string;
  positivePrompt: string;
  negativePrompt: string;
  referenceImages?: Array<{
    characterId?: string;
    url: string;
    use: string;
  }>;
  validation?: {
    valid: boolean;
    issues: string[];
  };
};

export type TTIPromptValidationIssue = {
  code: string;
  message: string;
  severity: 'warning' | 'error';
};

export type TTIPromptValidationResult = {
  valid: boolean;
  issues: TTIPromptValidationIssue[];
  fixedPrompt?: TTIPromptOutput;
};

export type SceneCharacterRef = {
  name: string;
  aliases?: string[];
  role?: string;
  type?: string;
  ageYears?: number;
  visualDescription?: string;
  safeDisplayName?: string;
};

export type BuildManifestInput = {
  seasonId: string;
  episodeId?: string;
  episodeTitle: string;
  moment: string;
  chapterExcerpt?: string;
  characters: SeasonCharacter[];
  sceneCharacters?: SceneCharacterRef[];
};

export type CompileContext = {
  roster: SeasonCharacter[];
  safetyBoundaries?: string[];
};
