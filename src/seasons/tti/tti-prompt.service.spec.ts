import { SeasonCharacter } from '../entities/season-character.entity';
import { TtiPromptService } from './tti-prompt.service';

function makeCharacter(partial: Partial<SeasonCharacter> & Pick<SeasonCharacter, 'characterId' | 'displayName' | 'role' | 'type' | 'visualDescription'>): SeasonCharacter {
  return {
    characterId: partial.characterId,
    seasonId: partial.seasonId || 'season-test',
    displayName: partial.displayName,
    internalName: partial.internalName || null,
    safeDisplayName: partial.safeDisplayName || null,
    aliases: partial.aliases || [],
    role: partial.role,
    type: partial.type,
    ageYears: partial.ageYears ?? null,
    visualDescription: partial.visualDescription,
    mainColors: partial.mainColors || [],
    silhouette: partial.silhouette || null,
    signatureItems: partial.signatureItems || [],
    personalityVisualCues: partial.personalityVisualCues || null,
    allowedVariations: partial.allowedVariations || [],
    doNotShow: partial.doNotShow || [],
    countRule: partial.countRule || 'exactly_one_when_selected',
    duplicatePrevention: partial.duplicatePrevention || null,
    placementPreference: partial.placementPreference || null,
    referenceImageUrl: partial.referenceImageUrl || null,
    referenceUse: partial.referenceUse || null,
    needsReview: partial.needsReview || false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const bowlGlowsRoster: SeasonCharacter[] = [
  makeCharacter({
    characterId: 'vika',
    displayName: 'Vika',
    internalName: 'Vika chiken пика',
    safeDisplayName: 'Vika',
    aliases: ['Vika chiken пика'],
    role: 'main_hero',
    type: 'human child',
    visualDescription: 'auburn-haired child girl in an emerald hooded cloak with dragon-scale trim, brown belt and boots, glowing amber crystal necklace',
    referenceImageUrl: 'https://example.com/vika.png',
    referenceUse: 'preserve identity, proportions, outfit, colors, and storybook style',
  }),
  makeCharacter({
    characterId: 'ivar',
    displayName: 'Ivar',
    role: 'child_ally',
    type: 'human child',
    visualDescription: 'blond boy in a blue fur-trimmed cloak, holding a dragon-eye stone',
  }),
  makeCharacter({
    characterId: 'midnight',
    displayName: 'Midnight Junior',
    internalName: 'Toothless Junior',
    safeDisplayName: 'Midnight Junior',
    aliases: ['Toothless Junior'],
    role: 'recurring_companion',
    type: 'young dragon',
    visualDescription: 'one small friendly black dragon cub with large soft green eyes and gentle posture',
    duplicatePrevention: 'Do not show a duplicate Midnight Junior or a second young dragon in the same scene',
  }),
  makeCharacter({
    characterId: 'shimmer',
    displayName: 'Shimmer',
    role: 'magical_helper',
    type: 'tiny glowing green fairy-like sprite',
    visualDescription: 'tiny glowing green fairy-like sprite with translucent wings',
  }),
];

describe('TtiPromptService', () => {
  const service = new TtiPromptService();

  const moment =
    'Vika crouches beside the stone bowl with the Hearth-Lantern, pouring golden light into it as Ivar, Toothless Junior, and Shimmer watch. The bowl glows with a swirling map of islands. A faint handprint shines on the floor. The background is a round stone chamber with carvings on the walls. The mood is warm, hopeful, and cooperative.';

  it('does not treat title words as characters', () => {
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The First Bowl Glows',
      moment,
      chapterExcerpt: '',
      characters: bowlGlowsRoster,
    });

    const names = manifest.selectedCharacters.map((item) => item.displayName);
    expect(names).toEqual(expect.arrayContaining(['Vika', 'Ivar', 'Midnight Junior', 'Shimmer']));
    expect(names).not.toEqual(expect.arrayContaining(['The First', 'Bowl Glows', 'Hearth', 'Lantern', 'She', 'Let', 'Inside']));
  });

  it('includes full moment text in the compiled prompt', () => {
    const soloMoment =
      'At the top of the Hearth-Stone Circle, Vika stands alone in cold swirling mist, raising the Hearth-Lantern high as golden light cuts through the fog. Below, only the faint curve of the spiral staircase is visible. A real hand reaches through the mist toward her.';
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Trust in the Mist',
      moment: soloMoment,
      characters: bowlGlowsRoster,
      sceneCharacters: [
        { name: 'Vika', aliases: ['Vika chiken пика'], role: 'main_hero' },
        { name: 'Ivar', role: 'child_ally' },
        { name: 'Elder Sigrid', aliases: ['Sigrid'], role: 'mentor' },
      ],
    });

    expect(manifest.selectedCharacters.map((item) => item.displayName)).toEqual(['Vika']);
    expect(manifest.props).toEqual([]);

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'Trust in the Mist',
        episodeNumber: 78,
        moment: soloMoment,
        visualManifest: manifest,
      },
      { roster: bowlGlowsRoster },
    );

    expect(compiled.positivePrompt).toContain('spiral staircase');
    expect(compiled.positivePrompt).toContain('real hand reaches through the mist');
    expect(compiled.positivePrompt).not.toMatch(/\bIvar\b/i);
    expect(compiled.positivePrompt).not.toMatch(/\bElder\b/i);
    expect(compiled.positivePrompt).not.toMatch(/\bSigrid\b/i);
    expect(compiled.positivePrompt).not.toMatch(/not visible|out of frame/i);
    expect(compiled.positivePrompt).not.toMatch(/closest to the glowing crystal/i);
  });

  it('includes appearance blocks for every figure named in the moment, including background silhouettes', () => {
    const roster: SeasonCharacter[] = [
      ...bowlGlowsRoster,
      makeCharacter({
        characterId: 'elder-sigrid',
        displayName: 'Elder',
        internalName: 'Elder Sigrid',
        safeDisplayName: 'Elder',
        aliases: ['Elder Sigrid', 'Sigrid'],
        role: 'mentor',
        type: 'human adult',
        ageYears: 68,
        visualDescription:
          'Warm-faced older Viking woman with silver-streaked hair braided back, long green cloak, and tired but kind eyes.',
      }),
    ];

    const depthMoment =
      'Vika and Ivar stand in the foreground in thick gray mist, palms pressed together as a fading golden thread stretches ahead. Vika holds the lantern high against a solid white wall of fog. Behind the fog wall, the faint silhouette of Sigrid sits leaning against a stone. Behind the same wall, Toothless Junior\'s scared face is barely visible through the mist.';

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The Fog Wall',
      moment: depthMoment,
      characters: roster,
      sceneCharacters: [
        { name: 'Vika', aliases: ['Vika chiken пика'], role: 'main_hero', ageYears: 9 },
        { name: 'Ivar', role: 'child_ally', ageYears: 10 },
        {
          name: 'Elder Sigrid',
          aliases: ['Sigrid'],
          role: 'mentor',
          ageYears: 68,
          visualDescription:
            'Warm-faced older Viking woman with silver-streaked hair braided back, long green cloak, and tired but kind eyes.',
        },
        {
          name: 'Toothless Junior',
          aliases: ['Midnight Junior', 'Junior'],
          role: 'recurring_companion',
          visualDescription: 'Small black dragon cub with large green eyes and frightened expression.',
        },
      ],
    });

    expect(manifest.selectedCharacters.map((item) => item.displayName)).toEqual(
      expect.arrayContaining(['Vika', 'Ivar', 'Elder Sigrid', 'Midnight Junior']),
    );

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'The Fog Wall',
        episodeNumber: 79,
        moment: depthMoment,
        visualManifest: manifest,
      },
      { roster },
    );

    expect(compiled.positivePrompt).toContain('Behind the fog wall, the faint silhouette of Sigrid sits leaning against a stone');
    expect(compiled.positivePrompt).toMatch(/Midnight Junior's scared face is barely visible through the mist/i);
    expect(compiled.positivePrompt).toMatch(/68-year-old|silver-streaked hair/i);
    expect(compiled.positivePrompt).toMatch(/small black dragon|green eyes/i);
    expect(compiled.positivePrompt).not.toMatch(/Show exactly \d+ story characters/i);
    expect(compiled.positivePrompt).toMatch(/Character appearance:/i);
  });

  it('includes companion only once in final prompt', () => {
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The First Bowl Glows',
      moment,
      characters: bowlGlowsRoster,
    });
    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'The First Bowl Glows',
        episodeNumber: 28,
        moment,
        seasonStyleGuide: {
          colorMood: 'deep blues, emerald greens, amber glow',
          visualTone: 'dynamic but warm storybook style',
        },
        heroReferenceImageUrl: 'https://example.com/vika.png',
        visualManifest: manifest,
      },
      { roster: bowlGlowsRoster },
    );

    expect(compiled.selectedCharacters.filter((item) => /midnight junior/i.test(item.name))).toHaveLength(1);
    expect(compiled.positivePrompt.match(/midnight junior/gi)?.length || 0).toBeLessThanOrEqual(2);
    expect(compiled.negativePrompt).toContain('duplicate Midnight Junior');
    expect(compiled.negativePrompt).not.toMatch(/\bextra dragons\b/i);
  });

  it('adds world-specific avoid terms and safety boundaries to the negative prompt', () => {
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Orbital Station 5678',
      moment: 'Rolan floats in the observation dome, watching Earth below.',
      characters: [
        makeCharacter({
          characterId: 'hero',
          displayName: 'Rolan',
          role: 'main_hero',
          type: 'human child',
          ageYears: 9,
          visualDescription: 'child in a silver space suit with a blue visor',
        }),
      ],
      sceneCharacters: [{ name: 'Rolan', role: 'main_hero', ageYears: 9 }],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'Orbital Station 5678',
        episodeNumber: 3,
        moment: 'Rolan floats in the observation dome, watching Earth below.',
        seasonStyleGuide: {
          colorMood: 'cool blues and soft starlight',
          visualTone: 'gentle retro-futurist storybook style',
          avoid: ['hyperrealism', 'dark horror lighting', 'chaotic crowd scenes'],
        },
        visualManifest: manifest,
      },
      {
        roster: manifest.selectedCharacters.map((character) =>
          makeCharacter({
            characterId: character.characterId,
            displayName: character.displayName,
            role: 'main_hero',
            type: 'human child',
            ageYears: character.ageYears,
            visualDescription: character.visualDescription,
          }),
        ),
        safetyBoundaries: ['No gore', 'No real-world politics', 'No traumatic harm'],
      },
    );

    expect(compiled.negativePrompt).toContain('hyperrealism');
    expect(compiled.negativePrompt).toContain('gore');
    expect(compiled.negativePrompt).toContain('real-world politics');
    expect(compiled.negativePrompt).not.toMatch(/\bscary dragon\b/i);
    expect(compiled.negativePrompt).not.toMatch(/\bextra dragons\b/i);
  });

  it('includes selected character doNotShow rules in the negative prompt', () => {
    const roster = [
      makeCharacter({
        characterId: 'hero',
        displayName: 'Rolan',
        role: 'main_hero',
        type: 'human child',
        visualDescription: 'child in a warm cloak holding a lantern',
        doNotShow: ['guns', 'military uniforms'],
      }),
    ];
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Quiet Harbor',
      moment: 'Rolan waits at the harbor with a lantern.',
      characters: roster,
      sceneCharacters: [{ name: 'Rolan', role: 'main_hero' }],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'Quiet Harbor',
        episodeNumber: 4,
        moment: 'Rolan waits at the harbor with a lantern.',
        visualManifest: manifest,
      },
      { roster },
    );

    expect(compiled.negativePrompt).toContain('guns');
    expect(compiled.negativePrompt).toContain('military uniforms');
  });

  it('uses canonical visual form for Shimmer', () => {
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The First Bowl Glows',
      moment: 'Shimmer fluttered nearby while Vika worked.',
      characters: bowlGlowsRoster,
    });
    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'The First Bowl Glows',
        episodeNumber: 28,
        moment: 'Shimmer fluttered nearby while Vika worked.',
        visualManifest: manifest,
      },
      { roster: bowlGlowsRoster },
    );

    expect(compiled.positivePrompt.toLowerCase()).toContain('tiny glowing green fairy-like sprite');
    expect(compiled.positivePrompt.toLowerCase()).not.toContain('toothless');
  });

  it('keeps prompt compact without raw JSON or storage notes', () => {
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The First Bowl Glows',
      moment,
      characters: bowlGlowsRoster,
    });
    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'The First Bowl Glows',
        episodeNumber: 28,
        moment,
        seasonStyleGuide: {
          colorMood: 'deep blues, emerald greens, amber glow',
          visualTone: 'dynamic but warm storybook style',
        },
        heroReferenceImageUrl: 'https://example.com/vika.png',
        visualManifest: manifest,
      },
      { roster: bowlGlowsRoster },
    );

    expect(compiled.positivePrompt.length).toBeLessThanOrEqual(1800);
    expect(compiled.negativePrompt.length).toBeLessThanOrEqual(600);
    expect(compiled.positivePrompt).not.toMatch(/\{|\}|episodeTitle|data URL/i);
    expect(compiled.positivePrompt.toLowerCase()).not.toContain('seasonpremise');
  });

  it('removes franchise-coded names from final prompt', () => {
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The First Bowl Glows',
      moment,
      characters: bowlGlowsRoster,
    });
    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'The First Bowl Glows',
        episodeNumber: 28,
        moment: `${moment} This world references How to Train Your Dragon.`,
        visualManifest: manifest,
      },
      { roster: bowlGlowsRoster },
    );
    const validation = service.validateTTIPrompt(compiled, bowlGlowsRoster, manifest);
    const prompt = validation.fixedPrompt || compiled;

    expect(prompt.positivePrompt.toLowerCase()).not.toContain('toothless');
    expect(prompt.positivePrompt.toLowerCase()).not.toContain('how to train your dragon');
  });

  it('does not include characters only mentioned in chapter recollection when sceneCharacters is set', () => {
    const ep31Roster: SeasonCharacter[] = [
      ...bowlGlowsRoster,
      makeCharacter({
        characterId: 'elder-sigrid',
        displayName: 'Elder',
        internalName: 'Elder Sigrid',
        safeDisplayName: 'Elder',
        aliases: ['Elder Sigrid'],
        role: 'minor_character',
        type: 'human elder',
        visualDescription:
          'A wise, warm older Viking woman who knows the old stories and speaks English with calm authority.',
      }),
    ];

    const ep31Moment =
      'Vika stands at the front of the group in a smooth tunnel, holding the dragon-eye stone, with Toothless Junior on one side and Shimmer on the other. Ivar holds the Hearth-Lantern up high.';

    const ep31Chapter =
      'Vika led the way into the new tunnel. She remembered what Elder Sigrid said: "Big changes happen only when characters act together." Ivar held the lantern high. Toothless Junior trotted beside her. Shimmer followed behind.';

    const sceneCharacters = [
      { name: 'Vika chiken пика', aliases: ['Vika'] },
      { name: 'Ivar the Listener', aliases: ['Ivar'] },
      { name: 'Toothless Junior', aliases: ['Toothless'] },
      { name: 'Shimmer', aliases: ['Shimmer'] },
    ];

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The Swift Path Ahead',
      moment: ep31Moment,
      chapterExcerpt: ep31Chapter,
      characters: ep31Roster,
      sceneCharacters,
    });

    const names = manifest.selectedCharacters.map((item) => item.displayName);
    expect(names).toEqual(expect.arrayContaining(['Vika', 'Ivar', 'Midnight Junior', 'Shimmer']));
    expect(names).not.toContain('Elder');
  });

  it('keeps the hero and companion when sceneCharacters are the source of truth', () => {
    const ep34Moment =
      "Vika, Ivar, Toothless Junior, and Shimmer stand at the edge of a huge cavern. In the center, a tall stone spiral rises, topped with a glowing green crystal. The Hearth-Lantern casts warm light. The blue dragon Shimmer nudges Vika's hand.";
    const ep34SceneCharacters = [
      {
        name: 'Vika chiken пика',
        aliases: ['Vika'],
        role: 'main_hero',
        visualDescription:
          'A young Viking girl with short, messy brown hair and bright green eyes. She wears a leather tunic and carries a small glowing crystal on a leather cord around her neck. Her expression is determined and curious.',
      },
      {
        name: 'Ivar the Listener',
        aliases: ['Ivar'],
        role: 'recurring_companion',
        visualDescription:
          'A young Viking boy with a calm, observant face and light brown hair tied back. He wears a simple wool tunic and carries a Hearth-Lantern that glows with warm amber light.',
      },
      {
        name: 'Toothless Junior',
        aliases: ['Toothless', 'Midnight Junior'],
        role: 'magical_helper',
        visualDescription:
          'A young black dragon with large, expressive green eyes and retractable teeth. His wings are still a bit too big for his body, and he moves with playful curiosity. He has a loyal, trusting posture near Vika.',
      },
      {
        name: 'Shimmer',
        aliases: ['Shimmer'],
        role: 'minor_character',
        visualDescription:
          'A small, shy blue dragon with pale blue scales and large, nervous eyes. Her wings are slightly translucent and shimmer when light hits them. She moves cautiously but is starting to trust Vika.',
      },
    ];

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The Spiral Path Opens',
      moment: ep34Moment,
      chapterExcerpt: '',
      characters: bowlGlowsRoster,
      sceneCharacters: ep34SceneCharacters,
    });

    const names = manifest.selectedCharacters.map((item) => item.displayName);
    expect(names).toEqual(expect.arrayContaining(['Vika', 'Ivar', 'Midnight Junior', 'Shimmer']));
    expect(names).not.toContain('Toothless');
  });

  it('validates prompt before API submission', () => {
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The First Bowl Glows',
      moment,
      characters: bowlGlowsRoster,
    });
    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'The First Bowl Glows',
        episodeNumber: 28,
        moment,
        visualManifest: manifest,
      },
      { roster: bowlGlowsRoster },
    );
    const validation = service.validateTTIPrompt(compiled, bowlGlowsRoster, manifest);

    expect(validation.valid).toBe(true);
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  it('uses the full moment text without adding crystal heuristics for spiral staircase scenes', () => {
    const spiralMoment =
      'Vika stands alone at the top of the Hearth-Stone Circle, raising the lantern high while cold mist swirls around her. Below, only the faint curve of the spiral staircase is visible through the fog.';
    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Lantern in the Mist',
      moment: spiralMoment,
      characters: bowlGlowsRoster,
      sceneCharacters: [{ name: 'Vika', role: 'main_hero' }],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'Lantern in the Mist',
        episodeNumber: 78,
        moment: spiralMoment,
        visualManifest: manifest,
      },
      { roster: bowlGlowsRoster },
    );

    expect(compiled.positivePrompt).toContain(spiralMoment);
    expect(compiled.positivePrompt).not.toMatch(/closest to the glowing crystal/i);
    expect(compiled.positivePrompt).not.toMatch(/reaching toward the glowing crystal/i);
  });

  it('does not introduce a third dragon from the hero description and uses one canonical companion name', () => {
    const roster: SeasonCharacter[] = [
      makeCharacter({
        characterId: 'vika',
        displayName: 'Vika',
        safeDisplayName: 'Vika',
        role: 'main_hero',
        type: 'human child',
        visualDescription:
          'A simple tunic in deep emerald green with a brown leather belt and sturdy boots, plus a small hooded cloak (same green) with dragon-scale pattern on the hood edge, Slightly shorter than other kids her age, with a rounded hood and a small dragon perched on her shoulder or flying beside her head.',
      }),
      makeCharacter({
        characterId: 'ivar',
        displayName: 'Ivar',
        role: 'minor_character',
        type: 'human child',
        visualDescription: 'A young Viking boy who is quiet, observant, and always tries to understand dragons before acting.',
      }),
      makeCharacter({
        characterId: 'midnight',
        displayName: 'Midnight Junior',
        internalName: 'Toothless Junior',
        safeDisplayName: 'Midnight Junior',
        aliases: ['Toothless Junior', 'Toothless'],
        role: 'magical_helper',
        type: 'dragon',
        visualDescription: 'A playful young dragon with black scales, large green eyes, and small wing nubs.',
      }),
      makeCharacter({
        characterId: 'shimmer',
        displayName: 'Shimmer',
        role: 'magical_helper',
        type: 'dragon',
        visualDescription: 'A small blue dragon with shimmering scales and a gentle expression.',
      }),
    ];

    const momentText =
      'Vika, Ivar, Midnight Junior, and Shimmer stand close around the green crystal on the giant stone spiral.';

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'The Heart of the Spiral',
      moment: momentText,
      characters: roster,
      sceneCharacters: [
        { name: 'Vika', role: 'main_hero' },
        { name: 'Ivar', role: 'minor_character' },
        { name: 'Toothless Junior', aliases: ['Midnight Junior'], role: 'magical_helper' },
        { name: 'Shimmer', role: 'magical_helper' },
      ],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'The Heart of the Spiral',
        episodeNumber: 35,
        moment: momentText,
        visualManifest: manifest,
      },
      { roster },
    );

    expect(compiled.positivePrompt).not.toMatch(/small dragon perched on her shoulder|flying beside her head/i);
    expect(compiled.positivePrompt).not.toMatch(/swift black dragon Junior/i);
    expect(compiled.selectedCharacters.filter((item) => item.name === 'Midnight Junior')).toHaveLength(1);
  });

  it('keeps scene-specific sleep state for Elder Sigrid and avoids duplicate Junior naming in episode 44 style scenes', () => {
    const roster: SeasonCharacter[] = [
      makeCharacter({
        characterId: 'vika',
        displayName: 'Vika',
        internalName: 'Vika chiken пика',
        safeDisplayName: 'Vika',
        aliases: ['Vika'],
        role: 'main_hero',
        type: 'human child',
        visualDescription: 'Energetic young girl with bright eyes, wearing a warm tunic and leather vest.',
      }),
      makeCharacter({
        characterId: 'ivar',
        displayName: 'Ivar',
        internalName: 'Ivar the Listener',
        safeDisplayName: 'Ivar',
        aliases: ['Ivar the Listener'],
        role: 'recurring_companion',
        type: 'human child',
        visualDescription: 'Quiet boy with thoughtful eyes, dark hair, and a simple wool tunic.',
      }),
      makeCharacter({
        characterId: 'elder-sigrid',
        displayName: 'Elder',
        internalName: 'Elder Sigrid',
        safeDisplayName: 'Elder',
        aliases: ['Elder Sigrid', 'Sigrid'],
        role: 'mentor',
        type: 'human adult',
        visualDescription: 'Warm-faced older woman with silver hair braided and wrapped around her head.',
      }),
      makeCharacter({
        characterId: 'midnight',
        displayName: 'Midnight Junior',
        internalName: 'Toothless Junior',
        safeDisplayName: 'Midnight Junior',
        aliases: ['Toothless Junior', 'Junior'],
        role: 'magical_helper',
        type: 'dragon',
        visualDescription: 'Small young dragon with dark grey scales, large green eyes, and folded wings.',
      }),
    ];

    const moment =
      "Vika kneeling beside the rubble, one hand on the stone chest, the key in her other hand, while grey mist swirls around her and Toothless Junior stands protectively near Sigrid's slumped form. Ivar holds the lantern high, its amber light cutting through the fog.";

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'A Friend Who Knows More',
      moment,
      chapterExcerpt: '',
      characters: roster,
      sceneCharacters: [
        {
          name: 'Vika chiken пика',
          aliases: ['Vika'],
          role: 'main_hero',
          visualDescription: 'Energetic young girl with bright eyes, wearing a warm tunic and leather vest.',
        },
        {
          name: 'Ivar the Listener',
          aliases: ['Ivar'],
          role: 'recurring_companion',
          visualDescription: 'Quiet boy with thoughtful eyes, dark hair, and a simple wool tunic.',
        },
        {
          name: 'Toothless Junior',
          aliases: ['Junior', 'Midnight Junior'],
          role: 'magical_helper',
          visualDescription: 'Small young dragon with dark grey scales, large green eyes, and folded wings.',
        },
        {
          name: 'Elder Sigrid',
          aliases: ['Sigrid'],
          role: 'mentor',
          visualDescription:
            'Warm-faced older woman with silver hair braided and wrapped around her head. Her eyes are kind but now closed in sleep.',
        },
      ],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'A Friend Who Knows More',
        episodeNumber: 44,
        moment,
        visualManifest: manifest,
      },
      { roster },
    );

    expect(compiled.selectedCharacters.filter((item) => item.name === 'Midnight Junior')).toHaveLength(1);
    expect(compiled.positivePrompt).not.toMatch(/Midnight Midnight Junior/i);
    expect(compiled.positivePrompt).toMatch(/storybook moment/i);
    expect(compiled.positivePrompt).not.toMatch(/\bElder, A wise, warm older Viking woman/i);
  });

  it('keeps age and visual state in TTI prompt while dropping non-visual biography text', () => {
    const roster: SeasonCharacter[] = [
      makeCharacter({
        characterId: 'elder-sigrid',
        displayName: 'Elder',
        internalName: 'Elder Sigrid',
        safeDisplayName: 'Elder',
        aliases: ['Elder Sigrid', 'Sigrid'],
        role: 'mentor',
        type: 'human adult',
        ageYears: 68,
        visualDescription:
          'Warm-faced older woman with silver hair braided around her head, long grey cloak, weathered leather pouch, worried eyes now closed in sleep, who knows the old stories and speaks English with calm authority.',
      }),
    ];

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Quiet Clue',
      moment: "Elder Sigrid rests against the cave wall, eyes closed in sleep, while the lantern glow reaches her face.",
      characters: roster,
      sceneCharacters: [
        {
          name: 'Elder Sigrid',
          role: 'mentor',
          ageYears: 68,
          visualDescription:
            'Warm-faced older woman with silver hair braided around her head, long grey cloak, weathered leather pouch, worried eyes now closed in sleep, who knows the old stories and speaks English with calm authority.',
        },
      ],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'Quiet Clue',
        episodeNumber: 44,
        moment: "Elder Sigrid rests against the cave wall, eyes closed in sleep, while the lantern glow reaches her face.",
        visualManifest: manifest,
      },
      { roster },
    );

    expect(compiled.positivePrompt).toMatch(/68-year-old/i);
    expect(compiled.positivePrompt).toMatch(/silver hair|grey cloak|weathered leather pouch|closed in sleep/i);
    expect(compiled.positivePrompt).not.toMatch(/knows the old stories|speaks English with calm authority/i);
  });

  it('removes alternative prop variants from prompt-facing visual descriptions', () => {
    const roster: SeasonCharacter[] = [
      makeCharacter({
        characterId: 'vika',
        displayName: 'Vika',
        role: 'main_hero',
        type: 'human child',
        ageYears: 9,
        visualDescription:
          'Energetic young girl with bright green eyes, emerald tunic, brown boots, and carries a small lantern or a carved wooden dragon.',
      }),
    ];

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Lantern Path',
      moment: 'Vika studies the carved arch while warm cave light reaches her face.',
      characters: roster,
      sceneCharacters: [
        {
          name: 'Vika',
          role: 'main_hero',
          type: 'human child',
          ageYears: 9,
          visualDescription:
            'Energetic young girl with bright green eyes, emerald tunic, brown boots, and carries a small lantern or a carved wooden dragon.',
        },
      ],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'Lantern Path',
        episodeNumber: 45,
        moment: 'Vika studies the carved arch while warm cave light reaches her face.',
        visualManifest: manifest,
      },
      { roster },
    );

    expect(compiled.positivePrompt).toContain('carries a small lantern');
    expect(compiled.positivePrompt).not.toMatch(/\bor a carved wooden dragon\b/i);
  });

  it('uses canonical roster appearance while keeping temporary scene-state overlays', () => {
    const roster: SeasonCharacter[] = [
      makeCharacter({
        characterId: 'ivar',
        displayName: 'Ivar',
        role: 'child_ally',
        type: 'human child',
        ageYears: 10,
        visualDescription: 'light-brown hair, blue wool tunic, brown boots',
      }),
    ];

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Cave Steps',
      moment: 'Ivar stands in the cave, holding the lantern high.',
      characters: roster,
      sceneCharacters: [
        {
          name: 'Ivar',
          role: 'child_ally',
          type: 'human child',
          ageYears: 10,
          visualDescription: 'brown hair, blue wool tunic, muddy sleeves, worried expression, holding the lantern high',
        },
      ],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'Cave Steps',
        episodeNumber: 47,
        moment: 'Ivar stands in the cave, holding the lantern high.',
        visualManifest: manifest,
      },
      { roster },
    );

    expect(compiled.positivePrompt).toMatch(/light-brown hair/i);
    expect(compiled.positivePrompt).not.toMatch(/,\s*brown hair\s*,/i);
    expect(compiled.positivePrompt).toMatch(/muddy sleeves|worried expression|holding the lantern high/i);
  });

  it('does not infer extra magical helpers when the scene character list is explicit', () => {
    const roster: SeasonCharacter[] = [
      makeCharacter({
        characterId: 'hero',
        displayName: 'Vika',
        role: 'main_hero',
        type: 'human child',
        ageYears: 9,
        visualDescription: 'emerald cloak, brown boots, worried expression',
      }),
      makeCharacter({
        characterId: 'ivar',
        displayName: 'Ivar',
        role: 'recurring_companion',
        type: 'human child',
        ageYears: 10,
        visualDescription: 'light-brown hair, blue wool tunic, brown boots',
      }),
      makeCharacter({
        characterId: 'guardian',
        displayName: 'Guardian',
        safeDisplayName: 'Guardian',
        internalName: 'Guardian Dragon',
        aliases: ['Guardian Dragon', 'Guardian'],
        role: 'magical_helper',
        type: 'dragon',
        visualDescription: 'huge dragon with deep blue scales and broad wings',
      }),
      makeCharacter({
        characterId: 'shimmer',
        displayName: 'Shimmer',
        role: 'magical_helper',
        type: 'small dragon',
        visualDescription: 'small blue dragon with translucent wings',
      }),
    ];

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Wake the Guardian',
      moment:
        'Vika wakes on the cold stone floor and looks up at the Guardian Dragon floating above her while Ivar runs in with a dim lantern.',
      chapterExcerpt:
        'The guardian dragon floated above the circle with one foggy eye open. Thick mist poured from its mouth.',
      characters: roster,
      sceneCharacters: [
        { name: 'Vika', role: 'main_hero', type: 'human child', visualDescription: 'emerald cloak, worried expression' },
        { name: 'Ivar', role: 'recurring_companion', type: 'human child', visualDescription: 'light-brown hair, blue tunic, holding a dim lantern' },
        { name: 'Guardian Dragon', role: 'magical_helper', type: 'dragon', visualDescription: 'huge dragon with deep blue scales, one foggy eye open, floating overhead' },
      ],
    });

    const names = manifest.selectedCharacters.map((item) => item.displayName);
    expect(names).toHaveLength(3);
    expect(names).toEqual(expect.arrayContaining(['Vika', 'Ivar']));
    expect(names).not.toContain('Shimmer');
  });

  it('adds a readable emotion for every selected character when the input visual descriptions are emotionally sparse', () => {
    const roster: SeasonCharacter[] = [
      makeCharacter({
        characterId: 'vika',
        displayName: 'Vika',
        role: 'main_hero',
        type: 'human child',
        ageYears: 9,
        visualDescription: 'short brown hair, emerald cloak, brown boots',
      }),
      makeCharacter({
        characterId: 'ivar',
        displayName: 'Ivar',
        role: 'child_ally',
        type: 'human child',
        ageYears: 10,
        visualDescription: 'light-brown hair, blue wool tunic, holding a lantern',
      }),
      makeCharacter({
        characterId: 'junior',
        displayName: 'Midnight Junior',
        role: 'recurring_companion',
        type: 'young dragon',
        visualDescription: 'small black dragon with green eyes',
      }),
    ];

    const manifest = service.buildEpisodeVisualManifest({
      seasonId: 'season-test',
      episodeTitle: 'Falling Ceiling',
      moment:
        'Vika and Ivar run through the cave as the ceiling shakes and stones begin falling around them while Midnight Junior stays close.',
      characters: roster,
      sceneCharacters: [
        { name: 'Vika', role: 'main_hero', type: 'human child', ageYears: 9, visualDescription: 'short brown hair, emerald cloak, brown boots' },
        { name: 'Ivar', role: 'child_ally', type: 'human child', ageYears: 10, visualDescription: 'light-brown hair, blue wool tunic, holding a lantern' },
        { name: 'Midnight Junior', role: 'recurring_companion', type: 'young dragon', visualDescription: 'small black dragon with green eyes' },
      ],
    });

    const compiled = service.compileTTIPrompt(
      {
        episodeTitle: 'Falling Ceiling',
        episodeNumber: 99,
        moment:
          'Vika and Ivar run through the cave as the ceiling shakes and stones begin falling around them while Midnight Junior stays close.',
        visualManifest: manifest,
      },
      { roster },
    );

    expect(compiled.selectedCharacters).toHaveLength(3);
    expect(compiled.selectedCharacters.every((character) => /expression|worried|determined|focused|attentive|alert/i.test(character.visual))).toBe(true);
    expect(compiled.positivePrompt).toMatch(/Vika[^.]*expression/i);
    expect(compiled.positivePrompt).toMatch(/Ivar[^.]*expression/i);
    expect(compiled.positivePrompt).toMatch(/Midnight Junior[^.]*expression/i);
  });
});
