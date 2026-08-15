export const TITLE_WORD_BLOCKLIST = new Set([
  'the', 'a', 'an', 'first', 'second', 'third', 'last', 'new', 'old', 'big', 'small',
  'bowl', 'glows', 'glow', 'inside', 'let', 'she', 'he', 'they', 'we', 'it', 'this', 'that',
  'hearth', 'lantern', 'stone', 'chapter', 'episode', 'story', 'storyhop',
]);

export const PRONOUN_BLOCKLIST = new Set([
  'she', 'he', 'they', 'we', 'it', 'i', 'you', 'her', 'him', 'them', 'his', 'their',
]);

export const FRANCHISE_TERMS = [
  'how to train your dragon',
  'как приручить дракона',
  'dreamworks',
  'disney',
  'pixar',
  'marvel',
  'harry potter',
  'star wars',
  'pokemon',
  'minecraft',
  'fortnite',
];

export const COPYRIGHTED_CHARACTER_NAMES = [
  'toothless',
  'hiccup',
  'astrid',
  'elsa',
  'mickey',
  'pikachu',
];

export const PROP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bhearth[- ]lantern\b/i, label: 'Hearth-Lantern pouring warm amber light' },
  { pattern: /\b(stone )?bowl\b/i, label: 'carved stone bowl' },
  { pattern: /\b(swirling )?glowing map\b/i, label: 'swirling glowing island map inside the bowl' },
  { pattern: /\bglowing map of islands\b/i, label: 'swirling glowing island map inside the bowl' },
  { pattern: /\bhandprint\b/i, label: 'faint glowing handprint on the stone floor' },
  { pattern: /\bdragon[- ]eye stone\b/i, label: 'dragon-eye stone' },
  { pattern: /\blantern\b/i, label: 'warm handheld lantern light' },
  { pattern: /\b(spiral )?symbol\b/i, label: 'abstract spiral symbol glow' },
  { pattern: /\bcarvings?\b/i, label: 'abstract carved wall markings' },
  { pattern: /\bcrystal\b/i, label: 'glowing crystal' },
];

export const GENERIC_NEGATIVE_PROMPT =
  'extra characters, crowd, weapons, blood, gore, injury, horror, scary imagery, aggressive violence, fear, readable text, logos, watermark, UI, title text, poster layout, collage, photorealism, 3D render, anime, comic ink, copyrighted franchise character design';

export const COMPANION_SAFE_NAME_OVERRIDES: Record<string, { safeName: string; visual: string }> = {
  'toothless junior': {
    safeName: 'Midnight Junior',
    visual: 'one small friendly black dragon cub with large soft green eyes and gentle posture',
  },
  'midnight junior': {
    safeName: 'Midnight Junior',
    visual: 'one small friendly black dragon cub with large soft green eyes and gentle posture',
  },
  toothless: {
    safeName: 'Midnight Junior',
    visual: 'one small friendly black dragon cub with large soft green eyes and gentle posture',
  },
};

export const KNOWN_ALLY_DEFAULTS: Record<string, { role: string; type: string; visual: string; safeName?: string }> = {
  ivar: {
    role: 'child_ally',
    type: 'human child',
    visual: 'young Viking boy with light-brown hair tied back, a simple blue wool tunic, and sturdy brown boots',
  },
  shimmer: {
    role: 'magical_helper',
    type: 'small dragon',
    visual: 'small blue dragon with shimmering pale-blue scales, translucent wings, and large gentle eyes',
  },
};

export const POSITIVE_PROMPT_MAX_CHARS = 1800;
export const NEGATIVE_PROMPT_MAX_CHARS = 600;
