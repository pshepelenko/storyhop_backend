export const DEMO_STORY_SLUG = 'moon-river-chase';
export const DEMO_STORY_ID = 'demo-moon-river-chase';
export const DEMO_MEDIA_VERSION = 'a2-v2';

const castVisualContract =
  'Consistent character designs in every image: Mira is a 9-year-old girl with warm brown skin, dark curly hair tied with a yellow scarf, bright curious eyes, a teal rain jacket, brown shorts, and red waterproof boots. Leo is a 10-year-old boy with light skin, freckles, sandy blond hair, round glasses, a blue hoodie, tan trousers, and a small brass compass on a cord. Bramble is a small friendly green river otter, not a hedgehog, with smooth wet fur, a long otter tail, rounded ears, webbed paws, shiny black eyes, and a tiny blue scarf. The Clockwork Crab is a large friendly brass clockwork crab with rounded toy-like claws, glowing blue eyes, springy metal legs, and no scary teeth.';

const styleGuard =
  'Original polished 2D painted children storybook illustration, warm moonlight, clear readable action, expressive faces, safe adventure mood. Show each named character exactly once. Avoid extra children, extra animals, hedgehog, spines, duplicate otter, scary monster, sharp claws, weapons, injury, blood, readable text, logos, watermark, poster layout, collage, photorealism, 3D render, anime, comic ink, copyrighted franchise character design.';

export const demoStoryContent = {
  demoStoryId: DEMO_STORY_ID,
  slug: DEMO_STORY_SLUG,
  title: 'The Moon-River Chase',
  scenario:
    'A fast, child-safe A2 demo adventure: Mira, Leo, and Bramble ride a glowing leaf-boat on the Moon-River. A friendly clockwork crab seems to chase them, but it is really trying to guide them. The child makes two choices and reaches one of two happy endings.',
  framework: {
    cast: [
      {
        name: 'Mira',
        ageYears: 9,
        role: 'central child hero',
        visual:
          '9-year-old girl with warm brown skin, dark curly hair tied with a yellow scarf, bright curious eyes, a teal rain jacket, brown shorts, and red waterproof boots',
      },
      {
        name: 'Leo',
        ageYears: 10,
        role: 'friend',
        visual:
          '10-year-old boy with light skin, freckles, sandy blond hair, round glasses, a blue hoodie, tan trousers, and a small brass compass on a cord',
      },
      {
        name: 'Bramble',
        ageYears: 2,
        role: 'companion',
        visual:
          'small friendly green river otter, not a hedgehog, with smooth wet fur, a long otter tail, rounded ears, webbed paws, shiny black eyes, and a tiny blue scarf',
      },
      {
        name: 'Clockwork Crab',
        role: 'safe comic obstacle',
        visual:
          'large friendly brass clockwork crab with rounded toy-like claws, glowing blue eyes, and springy metal legs, expressive but not scary',
      },
    ],
    branching: {
      start: 'start',
      nodes: {
        start: ['rapids', 'market'],
        rapids: ['beacon', 'cavern'],
        market: ['beacon', 'cavern'],
        beacon: [],
        cavern: [],
      },
    },
  },
};

export const demoStoryNodes = [
  {
    nodeId: 'demo-node-start',
    nodeKey: 'start',
    episodeNumber: 1,
    title: 'The Boat That Woke Up',
    chapterText:
      'Mira touches a silver oar. The small leaf-boat wakes up. It glows in the moonlight and moves away from the dock.\n\n"Wait!" says Mira.\n\nLeo jumps into the boat with his brass compass. Bramble, the green river otter, rolls in after him. The boat is already on the river.\n\nClack. Clack. Clack.\n\nA big brass crab steps out of the reeds. Its blue eyes shine. A tiny bell rings inside its shell.\n\n"That is the Moon-River guardian," says Leo. "I think it wants the boat back."\n\n"We did not steal it," says Mira. "It woke up!"\n\nThe river splits in two. On the left, bright rapids jump over glowing rocks. On the right, small lantern boats float near a night market. The crab runs faster. The leaf-boat waits for Mira.',
    introOptionsPhrase: 'Which way should Mira steer the boat?',
    highlightedVocabulary: [
      { term: 'oar', translationRu: 'весло' },
      { term: 'dock', translationRu: 'причал' },
      { term: 'guardian', translationRu: 'страж' },
    ],
    choices: [
      {
        id: 'A',
        text: 'Go into the bright rapids.',
        targetNodeKey: 'rapids',
        choiceType: 'brave',
      },
      {
        id: 'B',
        text: 'Turn toward the lantern market.',
        targetNodeKey: 'market',
        choiceType: 'clever',
      },
    ],
    illustrationPrompt:
      `${castVisualContract} Scene: Mira stands at the back of a glowing leaf-boat on a moonlit river, holding a silver oar and looking alert. Leo stands beside her, holding his brass compass with a worried but excited face. Bramble the green river otter is at the front of the boat, low and ready, clearly an otter with a long tail and blue scarf. Behind them, the friendly brass Clockwork Crab runs on smooth river stones with its tiny bell visible. Ahead, the river clearly splits: left side has bright white rapids over glowing rocks, right side has a floating lantern market with small warm lights. Dynamic chase moment, no one is falling, everyone is safe. ${styleGuard}`,
  },
  {
    nodeId: 'demo-node-rapids',
    nodeKey: 'rapids',
    episodeNumber: 2,
    title: 'Silver Rapids',
    chapterText:
      'Mira turns the oar left. The leaf-boat jumps into the rapids. Cold water splashes over the front of the boat. Bramble shakes his wet face.\n\nThe Clockwork Crab runs on the rocks beside them. It is fast. Its little bell rings again and again.\n\n"Big wave!" says Leo.\n\nMira holds the oar with both hands. The boat goes up the wave, then comes down with a splash.\n\nAhead, a willow tree hangs over the river. A bright rope swings from one branch. Behind the tree, Mira sees a green cave in the river wall. Soft light moves inside the cave.\n\nLeo points to the rope. "That can take us to the old beacon tower."\n\nBramble points to the green cave. The crab is getting closer.',
    introOptionsPhrase: 'What should Mira do now?',
    highlightedVocabulary: [
      { term: 'water', translationRu: 'вода' },
      { term: 'wave', translationRu: 'волна' },
      { term: 'rope', translationRu: 'веревка' },
    ],
    choices: [
      {
        id: 'A',
        text: 'Grab the bright rope.',
        targetNodeKey: 'beacon',
        choiceType: 'brave',
      },
      {
        id: 'B',
        text: 'Go into the green cave.',
        targetNodeKey: 'cavern',
        choiceType: 'curious',
      },
    ],
    illustrationPrompt:
      `${castVisualContract} Scene: the glowing leaf-boat rides through silver rapids, with splashing water frozen in the air. Mira is at the back, gripping the silver oar with both hands, determined and focused. Leo braces beside her, one hand on the boat and one hand holding the brass compass, worried but brave. Bramble the green river otter crouches at the bow with wet smooth fur, long otter tail visible, blue scarf flying, not a hedgehog. The friendly Clockwork Crab runs on rocks beside the river, keeping pace but not attacking. A willow branch with a bright rope hangs above the river, and a green cave mouth glows in the riverbank behind it. ${styleGuard}`,
  },
  {
    nodeId: 'demo-node-market',
    nodeKey: 'market',
    episodeNumber: 2,
    title: 'The Lantern Market',
    chapterText:
      'Mira turns the oar right. The leaf-boat slides into the night market. Blue and gold lanterns hang over the water. Little boats move slowly between the stalls.\n\n"Sorry!" says Leo, as they pass a fruit basket.\n\nBramble ducks under paper stars. The Clockwork Crab stops on a small bridge. It opens a tiny map from its shell.\n\nThe market has two ways out. One way is up. Empty baskets move on a rope line toward an old beacon tower. The other way is down. A low tunnel goes under the candle bridge.\n\nLeo looks at the baskets. "We can ride up."\n\nBramble looks at the tunnel. The crab looks at its map. Mira must choose fast.',
    introOptionsPhrase: 'How should the team leave the market?',
    highlightedVocabulary: [
      { term: 'lanterns', translationRu: 'фонари' },
      { term: 'basket', translationRu: 'корзина' },
      { term: 'tunnel', translationRu: 'тоннель' },
    ],
    choices: [
      {
        id: 'A',
        text: 'Ride in a basket to the tower.',
        targetNodeKey: 'beacon',
        choiceType: 'clever',
      },
      {
        id: 'B',
        text: 'Duck into the low tunnel.',
        targetNodeKey: 'cavern',
        choiceType: 'sneaky',
      },
    ],
    illustrationPrompt:
      `${castVisualContract} Scene: the glowing leaf-boat moves through a floating night market on the river. Mira sits forward with the silver oar, focused and ready to choose. Leo stands beside her with the brass compass, surprised and careful. Bramble the green river otter ducks under hanging paper stars, with smooth fur, long otter tail, webbed paws, blue scarf, clearly not a hedgehog. The friendly Clockwork Crab stands on a small wooden bridge and holds a tiny folded map from its shell. Around them are blue and gold lanterns, fruit baskets, floating stalls, a rope line with empty baskets going upward, and a low tunnel under a candle bridge. ${styleGuard}`,
  },
  {
    nodeId: 'demo-node-beacon',
    nodeKey: 'beacon',
    episodeNumber: 3,
    title: 'The River Beacon',
    chapterText:
      'Mira lands on the wooden floor of the beacon tower. Leo lands beside her and laughs. Bramble pops out of a rope basket and shakes dust from his fur.\n\nThe Clockwork Crab reaches the steps below them. It raises one brass claw. It does not snap. It points to the dark river.\n\nBlack fog is moving over the water. The beacon lamp is not shining.\n\n"It was not chasing us," says Leo. "It was bringing us here."\n\nMira puts the silver oar into the beacon lamp. The lamp fits the oar like a key. Warm gold light fills the tower.\n\nThe fog moves away. The river is safe again.\n\nThe crab rings its bell three times. It sounds like thank you.',
    introOptionsPhrase: 'The demo path ends here.',
    highlightedVocabulary: [
      { term: 'beacon', translationRu: 'маяк' },
      { term: 'fog', translationRu: 'туман' },
      { term: 'safe', translationRu: 'безопасный' },
    ],
    choices: [],
    isEnding: true,
    illustrationPrompt:
      `${castVisualContract} Scene: Mira stands inside a wooden beacon tower above the moonlit river, placing the silver oar into a round beacon lamp like a key. Her face is proud and relieved. Leo kneels beside her with his brass compass, smiling with understanding. Bramble the green river otter stands on a rope basket, blue scarf visible, smooth fur and long otter tail clear, not a hedgehog. Below the tower steps, the friendly Clockwork Crab points one rounded brass claw toward the river and rings a tiny bell. Warm golden light from the beacon pushes soft black fog away from the river. Happy safe ending. ${styleGuard}`,
  },
  {
    nodeId: 'demo-node-cavern',
    nodeKey: 'cavern',
    episodeNumber: 3,
    title: 'The Singing Cave',
    chapterText:
      'The leaf-boat slips into the green cave. The river becomes quiet. Water drops fall from the roof like tiny bells.\n\nMira holds up the silver oar. It glows brighter.\n\nLeo touches the cave wall. "Look. These marks are music."\n\nThe marks shine one by one. Bramble hums a soft note. The cave hums back.\n\nMira understands. The crab is not angry. It is keeping the beat. The river needs the right song to open the way home.\n\nMira taps the oar on the boat: one, two, three. Leo claps. Bramble hums. Outside, the Clockwork Crab clicks its legs in the same beat.\n\nA wall opens. Moonlight shines in. The boat floats out to calm water.',
    introOptionsPhrase: 'The demo path ends here.',
    highlightedVocabulary: [
      { term: 'quiet', translationRu: 'тихий' },
      { term: 'music', translationRu: 'музыка' },
      { term: 'home', translationRu: 'дом' },
    ],
    choices: [],
    isEnding: true,
    illustrationPrompt:
      `${castVisualContract} Scene: the glowing leaf-boat floats inside a green cave with calm water. Mira sits in the boat and taps the silver oar on the wooden floor, focused and hopeful. Leo sits beside her and claps the beat, brass compass on his chest, smiling with surprise. Bramble the green river otter hums at the front of the boat, smooth wet fur, long otter tail, rounded ears, blue scarf, clearly not a hedgehog. Glowing music marks light up on the cave wall. At the cave entrance, the friendly Clockwork Crab clicks its springy metal legs in the same rhythm. A wall opens to bright moonlight and calm water. ${styleGuard}`,
  },
] as const;
