/* eslint-disable no-console */
/**
 * Season start benchmark: framework → bible → outline (24 ep, 2 batches)
 * Compares 4 DeepSeek V4 variants on OpenRouter.
 *
 * Usage: node scripts/season-model-benchmark.cjs
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const OUTLINE_EPISODE_COUNT = 24;
const OUTLINE_BATCH_SIZE = 12;
const REPAIR_MODEL = 'deepseek/deepseek-v4-flash';
const REPAIR_PROVIDER = { order: ['baidu/fp8'], allow_fallbacks: false };

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const API_KEY = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
if (!API_KEY) {
  console.error('Missing OPEN_ROUTER_API_KEY');
  process.exit(1);
}

const childProfile = {
  childName: 'Mila',
  childAge: '7',
  languageLevel: 'A1',
};

const seasonSetup = {
  theme: 'friendship and courage',
  world: 'The Floating Orchard Isles — tiny islands of fruit trees connected by rope bridges and wind kites',
  vocabularyFocus: ['help', 'listen', 'brave', 'share'],
  preferredTone: 'warm, adventurous, gently funny',
  comments: 'Child loves dragons but keep them friendly helpers, not scary monsters.',
};

const parentSettings = {
  preferredTone: seasonSetup.preferredTone,
  comments: seasonSetup.comments,
  vocabularyFocus: seasonSetup.vocabularyFocus,
};

const VARIANTS = [
  {
    id: 'flash_no_thinking',
    label: 'DeepSeek V4 Flash, no thinking',
    model: 'deepseek/deepseek-v4-flash',
    reasoning: { enabled: false },
    tokenMultiplier: 1,
    useProvider: true,
  },
  {
    id: 'flash_medium_thinking',
    label: 'DeepSeek V4 Flash, thinking medium',
    model: 'deepseek/deepseek-v4-flash',
    reasoning: { effort: 'medium' },
    tokenMultiplier: 2,
    useProvider: true,
  },
  {
    id: 'pro_no_thinking',
    label: 'DeepSeek V4 Pro, no thinking',
    model: 'deepseek/deepseek-v4-pro',
    reasoning: { enabled: false },
    tokenMultiplier: 1.2,
    useProvider: false,
  },
  {
    id: 'pro_medium_thinking',
    label: 'DeepSeek V4 Pro, thinking medium',
    model: 'deepseek/deepseek-v4-pro',
    reasoning: { effort: 'medium' },
    tokenMultiplier: 2.5,
    useProvider: false,
  },
];

const STEP_LIMITS = {
  framework: 4500,
  bible: 5000,
  outlineBatch: 9000,
  repair: 12000,
};

function sliceFramework(framework) {
  return {
    seasonPremise: framework?.seasonPremise,
    centralProblem: framework?.centralProblem,
    dramaticQuestion: framework?.dramaticQuestion,
    heroWant: framework?.heroWant,
    heroNeed: framework?.heroNeed,
    incitingIncident: framework?.incitingIncident,
    midpointReversal: framework?.midpointReversal,
    lowPoint: framework?.lowPoint,
    finalChallenge: framework?.finalChallenge,
    resolution: framework?.resolution,
    miniArcPlan: framework?.miniArcPlan,
    toneGuide: framework?.toneGuide,
  };
}

function buildFrameworkPrompts() {
  const ageLimit = String((parseInt(childProfile.childAge, 10) || 6) + 3);
  const system = `You are StoryHop's senior children's story architect.
Create a season-level dramatic framework for an interactive English-learning story for children aged up to ${ageLimit}.

Rules:
- Return a single valid JSON object only. No markdown. No commentary.
- One central problem for 20-30 short episodes.
- Strong structure: mini-arcs, midpoint reversal, low point, resolution.
- Inciting incident must be world-specific. No fog, sleep, or dream openings.`;

  const user = `Create a strategic season framework.

Child profile:
${JSON.stringify(childProfile)}

Parent settings:
${JSON.stringify(parentSettings)}

Season setup:
${JSON.stringify(seasonSetup)}

Return JSON with: seasonPremise, centralProblem, dramaticQuestion, externalStakes, emotionalStakes, heroWant, heroNeed, antagonisticForce, rulesOfWorld, incitingIncident, pointOfNoReturn, miniArcPlan (at least 3 arcs with arcNumber, episodesRange, localGoal, mainObstacle, storyFunction), midpointReversal, lowPoint, finalChallenge, resolution, characterChange, safetyBoundaries, toneGuide, recurringMotifs.`;

  return { step: 'framework', system, user, schema: { type: 'framework' } };
}

function buildBiblePrompts(framework) {
  const system = `You are StoryHop's continuity designer.
Create a practical season bible for a children's interactive English-learning story.
Rules:
- Return a single valid JSON object only.
- Build on the framework. Keep vocabularyPlan.coreWords as a string array.`;

  const user = `Create a season bible.

Strategic season framework:
${JSON.stringify(sliceFramework(framework))}

Child profile:
${JSON.stringify(childProfile)}

Return JSON with: worldOverview, worldRules, mainLocations, mainCharacters, seasonContinuityRules, vocabularyPlan { coreWords, actionPhrases, reviewCadence }, rewardLogic, illustrationStyleGuide.`;

  return { step: 'bible', system, user, schema: { type: 'bible' } };
}

function buildOutlineBatchPrompts(framework, seasonBible, fromEpisode, toEpisode) {
  const system = `You are StoryHop's season outline writer.
Create episode outline items for an interactive children's season.
Rules:
- Return a single valid JSON object only.
- Compact strings. No markdown.
- Each episode connects to the framework and a mini-arc.`;

  const user = `Create outline episodes ${fromEpisode} through ${toEpisode} inclusive.

Strategic season framework:
${JSON.stringify(sliceFramework(framework))}

Season bible:
${JSON.stringify({
  worldOverview: seasonBible?.worldOverview,
  mainCharacters: seasonBible?.mainCharacters,
  vocabularyPlan: seasonBible?.vocabularyPlan,
})}

Return JSON:
{
  "episodes": [
    {
      "episodeNumber": ${fromEpisode},
      "miniArcNumber": 1,
      "title": "short title",
      "storyPurpose": "what changes",
      "conflict": "local obstacle",
      "vocabularyFocus": ["word"],
      "expectedChoiceTheme": "theme",
      "stateChangeGoal": "state update",
      "illustrationOpportunity": "visual moment",
      "cliffhangerOrHook": "hook"
    }
  ]
}`;

  return {
    step: `outline_${fromEpisode}_${toEpisode}`,
    system,
    user,
    schema: { type: 'outline_batch', fromEpisode, toEpisode },
  };
}

function buildContinuityPrompt(framework, episodes) {
  const system = `You are StoryHop's continuity checker. Return valid JSON only.`;
  const user = `Given this framework and ${episodes.length} episode outline items, return continuityCheck JSON:
{
  "centralProblemProgression": "short progression summary",
  "midpointEpisode": 12,
  "lowPointEpisode": 20,
  "finaleEpisodes": [23, 24]
}

Framework:
${JSON.stringify(sliceFramework(framework))}

Episodes sample:
${JSON.stringify(episodes.slice(0, 3).concat(episodes.slice(-2)))}`;

  return { step: 'outline_continuity', system, user, schema: { type: 'continuity_check' } };
}

function extractMessageText(message) {
  if (!message) return '';

  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' && part?.text) return part.text;
        return part?.text || part?.content || '';
      })
      .join('')
      .trim();
    if (text) return text;
  }

  if (typeof message.reasoning === 'string' && message.reasoning.trim()) {
    const match = message.reasoning.match(/\{[\s\S]*\}$/);
    if (match) return match[0];
  }

  return '';
}

function parseJsonResponse(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new Error('Empty model output');
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found: ${candidate.slice(0, 200)}`);
  }

  const jsonText = candidate.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = jsonText
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u0000-\u001f]+/g, ' ');
    return JSON.parse(repaired);
  }
}

function buildProvider(variant, allowFallbacks = true) {
  if (!variant.useProvider) return undefined;
  return { order: ['baidu/fp8'], allow_fallbacks: allowFallbacks };
}

async function callModel(variant, system, user, maxTokens, options = {}) {
  const started = Date.now();
  const body = {
    model: options.model || variant.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.7,
    max_tokens: maxTokens,
    reasoning: options.reasoning || variant.reasoning,
  };

  const provider = options.provider !== undefined
    ? options.provider
    : buildProvider(variant, options.allowFallbacks !== false);
  if (provider) body.provider = provider;

  if (options.useJsonMode !== false) {
    body.response_format = { type: 'json_object' };
  }

  let response;
  try {
    response = await axios.post('https://openrouter.ai/api/v1/chat/completions', body, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'StoryHop Benchmark',
      },
      timeout: 600000,
    });
  } catch (error) {
    const message = error?.response?.data?.error?.message || error.message || '';
    const isProviderError = /provider returned error|no endpoints found/i.test(message);
    if (isProviderError && provider && !options.providerRetried) {
      return callModel(variant, system, user, maxTokens, {
        ...options,
        provider: undefined,
        providerRetried: true,
      });
    }
    throw error;
  }

  const choice = response.data?.choices?.[0] || {};
  const message = choice.message || {};
  const raw = extractMessageText(message);

  return {
    latencyMs: Date.now() - started,
    usage: response.data?.usage || {},
    provider: response.data?.provider || null,
    model: response.data?.model || body.model,
    finishReason: choice.finish_reason || null,
    reasoningTokens: response.data?.usage?.completion_tokens_details?.reasoning_tokens || 0,
    raw,
    rawPreview: raw.slice(0, 400),
  };
}

function maxTokensFor(step, variant) {
  const base = STEP_LIMITS[step] || 4000;
  return Math.round(base * variant.tokenMultiplier);
}

async function repairJson(invalidOutput, targetSchema) {
  const system = `You repair invalid JSON for StoryHop. Return one valid JSON object only. Match the target schema.`;
  const user = `Target schema:\n${JSON.stringify(targetSchema)}\n\nBroken output:\n${String(invalidOutput).slice(0, 100000)}`;

  return callModel(
    { model: REPAIR_MODEL, reasoning: { enabled: false }, useProvider: true },
    system,
    user,
    STEP_LIMITS.repair,
    {
      model: REPAIR_MODEL,
      reasoning: { enabled: false },
      provider: REPAIR_PROVIDER,
      allowFallbacks: true,
      useJsonMode: true,
    },
  );
}

async function callStep(variant, prompt, stepKey) {
  const maxTokens = maxTokensFor(stepKey === 'framework' || stepKey === 'bible' ? stepKey : 'outlineBatch', variant);
  const attempts = [];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const scaledTokens = Math.round(maxTokens * (attempt === 1 ? 1 : attempt === 2 ? 1.4 : 1.8));
    let result;

    try {
      result = await callModel(variant, prompt.system, prompt.user, scaledTokens, {
        useJsonMode: attempt < 3,
      });
    } catch (error) {
      const message = error?.response?.data?.error?.message || error.message;
      attempts.push({ attempt, error: message });
      if (attempt === 3) throw new Error(`${prompt.step} API failed: ${message}`);
      continue;
    }

    if (!result.raw) {
      attempts.push({ attempt, error: 'empty content', finishReason: result.finishReason });
      if (attempt < 3) continue;
      throw new Error(`${prompt.step}: empty model output (finish=${result.finishReason})`);
    }

    try {
      const parsed = parseJsonResponse(result.raw);
      return {
        ...result,
        parsed,
        attempts,
        repaired: false,
      };
    } catch (parseError) {
      attempts.push({ attempt, parseError: parseError.message, finishReason: result.finishReason });

      try {
        const repaired = await repairJson(result.raw, prompt.schema);
        const parsed = parseJsonResponse(repaired.raw);
        return {
          latencyMs: result.latencyMs + repaired.latencyMs,
          usage: {
            total_tokens:
              Number(result.usage?.total_tokens || 0) + Number(repaired.usage?.total_tokens || 0),
          },
          provider: result.provider,
          model: result.model,
          reasoningTokens: result.reasoningTokens,
          parsed,
          attempts,
          repaired: true,
          repairModel: REPAIR_MODEL,
        };
      } catch (repairError) {
        if (attempt === 3) {
          throw new Error(`${prompt.step}: ${parseError.message}; repair failed: ${repairError.message}`);
        }
      }
    }
  }

  throw new Error(`${prompt.step}: exhausted retries`);
}

function scoreFramework(framework) {
  const issues = [];
  let score = 0;
  if (framework?.seasonPremise) score += 1;
  if (framework?.centralProblem) score += 1;
  if (Array.isArray(framework?.miniArcPlan) && framework.miniArcPlan.length >= 3) score += 2;
  else issues.push('miniArcPlan < 3');
  if (framework?.incitingIncident && !/fog|sleep|dream/i.test(String(framework.incitingIncident))) score += 1;
  else issues.push('generic or missing incitingIncident');
  if (framework?.midpointReversal && framework?.lowPoint && framework?.resolution) score += 2;
  else issues.push('missing major beats');
  if (framework?.heroWant && framework?.heroNeed) score += 1;
  return { score: Math.min(score, 8), max: 8, issues };
}

function getCoreWords(vocabularyPlan) {
  if (!vocabularyPlan) return [];
  if (Array.isArray(vocabularyPlan.coreWords)) return vocabularyPlan.coreWords;
  if (Array.isArray(vocabularyPlan.coreVocabulary)) return vocabularyPlan.coreVocabulary;
  if (Array.isArray(vocabularyPlan.focusWords)) return vocabularyPlan.focusWords;
  return [];
}

function scoreBible(bible) {
  const issues = [];
  let score = 0;
  if (bible?.worldOverview) score += 1;
  if (Array.isArray(bible?.mainCharacters) && bible.mainCharacters.length >= 2) score += 2;
  else issues.push('few mainCharacters');
  if (Array.isArray(bible?.mainLocations) && bible.mainLocations.length >= 2) score += 1;
  if (getCoreWords(bible?.vocabularyPlan).length) score += 2;
  else issues.push('missing vocabulary core words');
  if (Array.isArray(bible?.seasonContinuityRules) && bible.seasonContinuityRules.length) score += 1;
  return { score: Math.min(score, 7), max: 7, issues };
}

function scoreOutline(outline) {
  const issues = [];
  let score = 0;
  const episodes = Array.isArray(outline?.episodes) ? outline.episodes : [];
  if (episodes.length >= OUTLINE_EPISODE_COUNT - 2) score += 3;
  else issues.push(`only ${episodes.length} episodes`);
  if (outline?.continuityCheck?.midpointEpisode) score += 1;
  if (outline?.continuityCheck?.lowPointEpisode) score += 1;
  const miniArcs = new Set(episodes.map((item) => item.miniArcNumber).filter(Boolean));
  if (miniArcs.size >= 3) score += 2;
  else issues.push('weak mini-arc spread');
  const ep1 = episodes.find((item) => Number(item.episodeNumber) === 1);
  if (ep1?.storyPurpose && ep1?.conflict) score += 1;
  else issues.push('weak episode 1 outline');
  return { score: Math.min(score, 8), max: 8, issues };
}

async function generateOutline(variant, framework, seasonBible) {
  const batches = [];
  let totalLatency = 0;
  let totalTokens = 0;
  const episodes = [];

  for (let start = 1; start <= OUTLINE_EPISODE_COUNT; start += OUTLINE_BATCH_SIZE) {
    const end = Math.min(start + OUTLINE_BATCH_SIZE - 1, OUTLINE_EPISODE_COUNT);
    const prompt = buildOutlineBatchPrompts(framework, seasonBible, start, end);
    console.log(`  outline ${start}-${end}...`);
    const batchRes = await callStep(variant, prompt, 'outlineBatch');
    batches.push({
      range: `${start}-${end}`,
      latencyMs: batchRes.latencyMs,
      repaired: batchRes.repaired,
      count: Array.isArray(batchRes.parsed?.episodes) ? batchRes.parsed.episodes.length : 0,
    });
    totalLatency += batchRes.latencyMs;
    totalTokens += Number(batchRes.usage?.total_tokens || 0);
    episodes.push(...(batchRes.parsed?.episodes || []));
  }

  episodes.sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));

  console.log('  outline continuity...');
  const continuityPrompt = buildContinuityPrompt(framework, episodes);
  const continuityRes = await callStep(variant, continuityPrompt, 'outlineBatch');
  totalLatency += continuityRes.latencyMs;
  totalTokens += Number(continuityRes.usage?.total_tokens || 0);

  return {
    outline: {
      episodeCount: episodes.length,
      episodes,
      continuityCheck: continuityRes.parsed || {},
    },
    batches,
    latencyMs: totalLatency,
    tokens: totalTokens,
  };
}

async function runVariant(variant) {
  console.log(`\n=== ${variant.label} ===`);
  const result = {
    variant: {
      id: variant.id,
      label: variant.label,
      model: variant.model,
      reasoning: variant.reasoning,
      provider: variant.useProvider ? 'baidu/fp8 (fallback ok)' : 'default',
    },
    steps: {},
    scores: {},
    totalLatencyMs: 0,
    totalTokens: 0,
    error: null,
    success: false,
  };

  try {
    console.log('framework...');
    const frameworkPrompt = buildFrameworkPrompts();
    const frameworkRes = await callStep(variant, frameworkPrompt, 'framework');
    result.steps.framework = {
      latencyMs: frameworkRes.latencyMs,
      usage: frameworkRes.usage,
      provider: frameworkRes.provider,
      repaired: frameworkRes.repaired,
      preview: frameworkRes.parsed?.seasonPremise || frameworkRes.rawPreview,
    };
    result.scores.framework = scoreFramework(frameworkRes.parsed);
    result.totalLatencyMs += frameworkRes.latencyMs;
    result.totalTokens += Number(frameworkRes.usage?.total_tokens || 0);

    console.log('bible...');
    const bibleRes = await callStep(variant, buildBiblePrompts(frameworkRes.parsed), 'bible');
    result.steps.bible = {
      latencyMs: bibleRes.latencyMs,
      usage: bibleRes.usage,
      provider: bibleRes.provider,
      repaired: bibleRes.repaired,
      preview: bibleRes.parsed?.worldOverview || bibleRes.rawPreview,
    };
    result.scores.bible = scoreBible(bibleRes.parsed);
    result.totalLatencyMs += bibleRes.latencyMs;
    result.totalTokens += Number(bibleRes.usage?.total_tokens || 0);

    console.log('outline...');
    const outlineResult = await generateOutline(variant, frameworkRes.parsed, bibleRes.parsed);
    result.steps.outline = {
      latencyMs: outlineResult.latencyMs,
      episodeCount: outlineResult.outline.episodeCount,
      batches: outlineResult.batches,
      preview: outlineResult.outline.continuityCheck?.centralProblemProgression || '',
    };
    result.totalLatencyMs += outlineResult.latencyMs;
    result.totalTokens += outlineResult.tokens;
    result.scores.outline = scoreOutline(outlineResult.outline);

    result.artifacts = {
      framework: frameworkRes.parsed,
      bible: bibleRes.parsed,
      outline: {
        episodeCount: outlineResult.outline.episodeCount,
        continuityCheck: outlineResult.outline.continuityCheck,
        firstEpisodes: outlineResult.outline.episodes.slice(0, 3),
        lastEpisodes: outlineResult.outline.episodes.slice(-2),
      },
    };

    result.scores.total = {
      score: result.scores.framework.score + result.scores.bible.score + result.scores.outline.score,
      max: result.scores.framework.max + result.scores.bible.max + result.scores.outline.max,
    };
    result.success = true;
  } catch (error) {
    result.error = error?.response?.data?.error?.message || error?.message || String(error);
    console.error(`FAILED: ${result.error}`);
  }

  return result;
}

function buildSummary(report) {
  const lines = [
    '# Season model benchmark',
    '',
    `Finished: ${report.finishedAt}`,
    `Outline episodes: ${OUTLINE_EPISODE_COUNT} (2×${OUTLINE_BATCH_SIZE} batches)`,
    '',
    '| Variant | Status | Time | Score | Tokens | Provider |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ];

  for (const item of report.variants) {
    const score = item.scores?.total ? `${item.scores.total.score}/${item.scores.total.max}` : 'n/a';
    lines.push(
      `| ${item.variant.id} | ${item.success ? 'OK' : 'FAIL'} | ${Math.round((item.totalLatencyMs || 0) / 1000)}s | ${score} | ${item.totalTokens || 0} | ${item.variant.provider} |`,
    );
    if (item.error) lines.push(`| | _${item.error}_ | | | | |`);
  }

  return lines.join('\n');
}

async function main() {
  const started = Date.now();
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, `season-model-benchmark-${stamp}.json`);
  const summaryPath = path.join(outputDir, `season-model-benchmark-${stamp}.md`);

  const report = {
    startedAt: new Date().toISOString(),
    methodology: {
      steps: ['framework', 'bible', 'outline_2_batches', 'continuity_check'],
      outlineEpisodeCount: OUTLINE_EPISODE_COUNT,
      flashProvider: 'baidu/fp8',
      repairModel: REPAIR_MODEL,
    },
    childProfile,
    seasonSetup,
    variants: [],
  };

  for (const variant of VARIANTS) {
    const variantResult = await runVariant(variant);
    report.variants.push(variantResult);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  }

  report.finishedAt = new Date().toISOString();
  report.totalBenchmarkMs = Date.now() - started;
  report.successCount = report.variants.filter((item) => item.success).length;
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(summaryPath, buildSummary(report));

  console.log(`\nSaved JSON: ${outputPath}`);
  console.log(`Saved summary: ${summaryPath}`);
  console.log(`Success: ${report.successCount}/${report.variants.length}`);

  for (const item of report.variants) {
    const totalScore = item.scores?.total;
    console.log(
      `${item.variant.id}: ${item.success ? 'OK' : 'FAIL'} | ${item.totalLatencyMs || 0} ms | score ${totalScore ? `${totalScore.score}/${totalScore.max}` : 'n/a'} | tokens ${item.totalTokens || 0}`,
    );
  }

  if (report.successCount < report.variants.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
