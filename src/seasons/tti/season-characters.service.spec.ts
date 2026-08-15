import { Repository } from 'typeorm';
import { SeasonCharacter } from '../entities/season-character.entity';
import { SeasonCharactersService } from './season-characters.service';

function createRepo(initial: SeasonCharacter[] = []): Repository<SeasonCharacter> {
  const store = [...initial];
  return {
    find: jest.fn(async ({ where }) => store.filter((item) => item.seasonId === where.seasonId)),
    findOne: jest.fn(async ({ where }) => store.find((item) => item.characterId === where.characterId) || null),
    create: jest.fn((data) => data as SeasonCharacter),
    save: jest.fn(async (records) => {
      const items = Array.isArray(records) ? records : [records];
      for (const item of items) {
        const index = store.findIndex((entry) => entry.characterId === item.characterId);
        if (index >= 0) store[index] = item;
        else store.push(item);
      }
      return items;
    }),
  } as unknown as Repository<SeasonCharacter>;
}

describe('SeasonCharactersService sync', () => {
  it('adds season bible characters during initial setup', async () => {
    const repo = createRepo();
    const service = new SeasonCharactersService(repo);

    const roster = await service.syncFromSeasonBible('season-1', {
      mainCharacters: [
        { name: 'Ivar', role: 'ally', personality: 'brave blond boy' },
        { name: 'Shimmer', role: 'helper', personality: 'tiny glowing sprite' },
      ],
    });

    expect(roster.map((item) => item.displayName)).toEqual(expect.arrayContaining(['Ivar', 'Shimmer']));
    expect(roster.every((item) => item.needsReview)).toBe(true);
  });

  it('adds new characters from episode sceneCharacters without duplicating existing ones', async () => {
    const repo = createRepo([
      {
        characterId: 'vika',
        seasonId: 'season-1',
        displayName: 'Vika',
        internalName: 'Vika',
        safeDisplayName: 'Vika',
        aliases: ['Vika'],
        role: 'main_hero',
        type: 'human child',
        ageYears: 9,
        visualDescription: 'emerald cloak hero',
        mainColors: [],
        silhouette: null,
        signatureItems: [],
        personalityVisualCues: null,
        allowedVariations: [],
        doNotShow: [],
        countRule: 'exactly_one_when_selected',
        duplicatePrevention: null,
        placementPreference: null,
        referenceImageUrl: null,
        referenceUse: null,
        needsReview: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    const service = new SeasonCharactersService(repo);

    const roster = await service.syncFromEpisodeContent('season-1', {
      sceneCharacters: [
        {
          name: 'Vika',
          role: 'main_hero',
          type: 'human child',
          ageYears: 9,
          visualDescription: 'emerald cloak hero',
        },
        {
          name: 'Ivar',
          role: 'child_ally',
          type: 'human child',
          ageYears: 10,
          visualDescription: 'blond boy in a blue fur-trimmed cloak',
        },
      ],
    });

    expect(roster).toHaveLength(2);
    expect(roster.map((item) => item.displayName)).toEqual(expect.arrayContaining(['Vika', 'Ivar']));
  });

  it('rejects invalid scene character names like title words', async () => {
    const repo = createRepo();
    const service = new SeasonCharactersService(repo);

    const roster = await service.syncFromEpisodeContent('season-1', {
      sceneCharacters: [
        { name: 'The First', role: 'minor_character', type: 'unknown', visualDescription: 'x' },
        { name: 'Lantern', role: 'minor_character', type: 'unknown', visualDescription: 'x' },
        { name: 'Ivar', role: 'child_ally', type: 'human child', ageYears: 10, visualDescription: 'blond boy' },
      ],
    });

    expect(roster.map((item) => item.displayName)).toEqual(['Ivar']);
  });

  it('persists ageYears from season bible and episode scene characters', async () => {
    const repo = createRepo();
    const service = new SeasonCharactersService(repo);

    const fromBible = await service.syncFromSeasonBible('season-1', {
      mainCharacters: [{ name: 'Ivar', role: 'ally', ageYears: 10, personality: 'brave blond boy' }],
    });

    expect(fromBible.find((item) => item.displayName === 'Ivar')?.ageYears).toBe(10);

    const fromEpisode = await service.syncFromEpisodeContent('season-1', {
      sceneCharacters: [
        { name: 'Ivar', role: 'child_ally', type: 'human child', ageYears: 11, visualDescription: 'older blond boy in a blue cloak' },
      ],
    });

    expect(fromEpisode.find((item) => item.displayName === 'Ivar')?.ageYears).toBe(11);
  });

  it('normalizes hero visual description to one canonical prop instead of alternatives', async () => {
    const repo = createRepo();
    const service = new SeasonCharactersService(repo);

    const roster = await service.syncFromSeasonBible(
      'season-1',
      { mainCharacters: [] },
      {
        heroProfile: {
          name: 'Vika',
          heroType: 'human child',
          ageYears: 9,
          signatureItem: 'small lantern or a carved wooden dragon',
        },
        heroVisualBrief: {
          speciesOrType: 'human child',
          hairFurOrSurface: 'short brown hair, bright green eyes',
          outfit: 'emerald tunic and brown boots',
          silhouette: 'small determined child silhouette',
          consistencyNotes: ['often carries a small lantern or a carved wooden dragon'],
        },
        heroReferenceImageUrl: null,
      } as any,
    );

    const hero = roster.find((item) => item.displayName === 'Vika');
    expect(hero?.visualDescription).toContain('carries a small lantern');
    expect(hero?.visualDescription).not.toMatch(/\bor\b/i);
    expect(hero?.visualDescription).not.toContain('carved wooden dragon');
  });

  it('keeps canonical appearance for existing characters while preserving temporary scene state', async () => {
    const repo = createRepo([
      {
        characterId: 'ivar',
        seasonId: 'season-1',
        displayName: 'Ivar',
        internalName: 'Ivar',
        safeDisplayName: 'Ivar',
        aliases: ['Ivar'],
        role: 'child_ally',
        type: 'human child',
        ageYears: 10,
        visualDescription: 'light-brown hair, blue wool tunic, brown boots',
        mainColors: [],
        silhouette: null,
        signatureItems: [],
        personalityVisualCues: null,
        allowedVariations: [],
        doNotShow: [],
        countRule: 'exactly_one_when_selected',
        duplicatePrevention: null,
        placementPreference: null,
        referenceImageUrl: null,
        referenceUse: null,
        needsReview: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    const service = new SeasonCharactersService(repo);

    await service.syncFromEpisodeContent('season-1', {
      sceneCharacters: [
        {
          name: 'Ivar',
          role: 'child_ally',
          type: 'human child',
          ageYears: 10,
          visualDescription: 'brown hair, blue wool tunic, muddy sleeves, worried expression',
        },
      ],
    });

    const canonicalized = await service.canonicalizeSceneCharacters('season-1', [
      {
        name: 'Ivar',
        role: 'child_ally',
        type: 'human child',
        ageYears: 10,
        visualDescription: 'brown hair, blue wool tunic, muddy sleeves, worried expression',
      },
    ]);

    expect(canonicalized[0]?.visualDescription).toContain('light-brown hair');
    expect(canonicalized[0]?.visualDescription).not.toContain(', brown hair,');
    expect(canonicalized[0]?.visualDescription).toContain('muddy sleeves');
    expect(canonicalized[0]?.visualDescription).toContain('worried expression');
  });

  it('upgrades low-signal canonical descriptions from episode visuals while stripping transient scene state', async () => {
    const repo = createRepo([
      {
        characterId: 'ivar',
        seasonId: 'season-1',
        displayName: 'Ivar',
        internalName: 'Ivar the Listener',
        safeDisplayName: 'Ivar',
        aliases: ['Ivar the Listener', 'Ivar'],
        role: 'child_ally',
        type: 'human child',
        ageYears: 10,
        visualDescription: 'A young Viking boy who is quiet, observant, and always tries to understand dragons before acting.',
        mainColors: [],
        silhouette: null,
        signatureItems: [],
        personalityVisualCues: null,
        allowedVariations: [],
        doNotShow: [],
        countRule: 'exactly_one_when_selected',
        duplicatePrevention: null,
        placementPreference: null,
        referenceImageUrl: null,
        referenceUse: null,
        needsReview: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    const service = new SeasonCharactersService(repo);

    const updated = await service.syncFromEpisodeContent('season-1', {
      sceneCharacters: [
        {
          name: 'Ivar',
          role: 'child_ally',
          type: 'human child',
          ageYears: 10,
          visualDescription: 'light-brown hair, blue wool tunic, brown boots, holding a lantern, worried expression',
        },
      ],
    });

    const ivar = updated.find((item) => item.displayName === 'Ivar');
    expect(ivar?.visualDescription).toContain('light-brown hair');
    expect(ivar?.visualDescription).toContain('blue wool tunic');
    expect(ivar?.visualDescription).not.toContain('holding a lantern');
    expect(ivar?.visualDescription).not.toContain('worried expression');
  });
});
