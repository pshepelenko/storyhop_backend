/* Safe production diagnostic: it prints no credentials or prompt content. */
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const axios = require('axios');

const key = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPEN_ROUTER_API_KEY is not configured');

const chatModel = process.env.OPENROUTER_STORY_MODEL || 'deepseek/deepseek-v4-flash';
const ttsModel = process.env.OPENROUTER_TTS_MODEL || 'hexgrad/kokoro-82m';
const referer = process.env.FRONTEND_URL || 'http://localhost:3001';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': referer, 'X-Title': 'StoryHop diagnostics' };
const routing = {
  allow_fallbacks: process.env.OPENROUTER_STORY_PROVIDER_ALLOW_FALLBACKS !== 'false',
  ...(process.env.OPENROUTER_STORY_PROVIDER_ORDER ? { order: process.env.OPENROUTER_STORY_PROVIDER_ORDER.split(',').map((item) => item.trim()).filter(Boolean) } : {}),
  ...(process.env.OPENROUTER_STORY_PROVIDER_SORT ? { sort: process.env.OPENROUTER_STORY_PROVIDER_SORT } : {}),
};

function summary(name, response, error) {
  const body = error?.response?.data || response?.data || {};
  const meta = response?.headers || error?.response?.headers || {};
  const isBinary = Buffer.isBuffer(body) || body instanceof ArrayBuffer;
  console.log(JSON.stringify({
    name,
    ok: Boolean(response),
    status: response?.status || error?.response?.status || null,
    code: isBinary ? error?.code || null : body?.error?.code || error?.code || null,
    message: isBinary ? error?.message || null : body?.error?.message || error?.message || null,
    requestId: meta['x-request-id'] || meta['request-id'] || (!isBinary && body?.id) || null,
    provider: isBinary ? null : body?.provider || body?.usage?.provider || null,
    rateLimit: Object.fromEntries(Object.entries(meta).filter(([key]) => key.toLowerCase().startsWith('x-ratelimit'))),
    responseShape: isBinary ? `binary:${Buffer.isBuffer(body) ? body.length : body.byteLength}` : body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : typeof body,
  }));
}

async function probe(name, url, body, options = {}) {
  try { summary(name, await axios.post(url, body, { headers, timeout: 30000, ...options })); }
  catch (error) { summary(name, null, error); }
}

(async () => {
  await probe('chat_without_routing', 'https://openrouter.ai/api/v1/chat/completions', { model: chatModel, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 4 });
  await probe('chat_with_routing', 'https://openrouter.ai/api/v1/chat/completions', { model: chatModel, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 4, provider: routing });
  await probe('kokoro_tts', 'https://openrouter.ai/api/v1/audio/speech', { model: ttsModel, input: 'Hello.', voice: process.env.OPENROUTER_TTS_VOICE || 'bm_lewis', response_format: 'mp3', speed: 0.82 }, { responseType: 'arraybuffer' });
})();
