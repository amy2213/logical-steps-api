const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';
const SITE_URL = 'https://amy2213.github.io/logical-steps-dashboard/';

const ORIGINS = new Set(['http://localhost:5173', 'https://amy2213.github.io']);
const ROLES = new Set(['context', 'premise', 'conclusion', 'assumption', 'counterpoint']);
const CONNECTIVES = new Set(['because', 'therefore', 'unless', 'but', 'if/then']);

function cors(origin) {
  return {
    ...(origin && ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function reply(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) },
  });
}

function parseModelJson(content) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Empty model response.');
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

function normalizeAnalysis(value, sourceText, elapsedMs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Analysis must be an object.');
  if (typeof value.gist !== 'string' || !value.gist.trim()) throw new Error('Analysis gist is missing.');
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) throw new Error('Analysis nodes are missing.');

  const ids = new Set();
  const nodes = value.nodes.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Node ${index + 1} is invalid.`);
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `n${index + 1}`;
    if (ids.has(id)) throw new Error('Node IDs must be unique.');
    ids.add(id);
    if (!ROLES.has(raw.role)) throw new Error(`Unknown node role: ${raw.role}`);
    if (typeof raw.plain !== 'string' || !raw.plain.trim()) throw new Error('Every node requires plain text.');

    const node = {
      id,
      role: raw.role,
      plain: raw.plain.trim(),
      original: typeof raw.original === 'string' ? raw.original : '',
      dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.filter((id) => typeof id === 'string') : [],
    };
    if (CONNECTIVES.has(raw.connective)) node.connective = raw.connective;
    if (typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1) node.confidence = raw.confidence;
    return node;
  });

  for (const node of nodes) {
    node.dependsOn = node.dependsOn.filter((id) => ids.has(id) && id !== node.id);
  }

  return {
    id: crypto.randomUUID(),
    sourceText,
    gist: value.gist.trim(),
    nodes,
    meta: { model: MODEL, elapsedMs, stageTimings: {} },
  };
}

function prompt() {
  return `You are the analysis engine for Logical Steps Dashboard. Return JSON only, never Markdown.
Shape: {"gist":"summary","nodes":[{"id":"n1","role":"context|premise|conclusion|assumption|counterpoint","plain":"clear wording","original":"exact source wording or empty for assumptions","connective":"because|therefore|unless|but|if/then","dependsOn":[],"confidence":0.9}]}
Rules: preserve qualifiers; use unique IDs; dependencies must reference existing IDs; assumptions must have original ""; omit connective or confidence when not applicable; map the argument without claiming it is true.`;
}

export default {
  async fetch(request, env) {
    const started = Date.now();
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      if (!origin || !ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      return reply({ ok: true, service: 'logical-steps-api' }, 200, origin);
    }
    if (url.pathname !== '/v1/analyze' || request.method !== 'POST') {
      return reply({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404, origin);
    }
    if (origin && !ORIGINS.has(origin)) {
      return reply({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin is not allowed.' } }, 403, origin);
    }
    if (!env.OPENROUTER_API_KEY) {
      return reply({ error: { code: 'SERVER_CONFIGURATION_ERROR', message: 'The analysis service is not configured.' } }, 500, origin);
    }

    let body;
    try { body = await request.json(); }
    catch { return reply({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, 400, origin); }

    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return reply({ error: { code: 'INVALID_TEXT', message: 'A non-empty text field is required.' } }, 400, origin);
    if (text.length > 12000) return reply({ error: { code: 'TEXT_TOO_LONG', message: 'Text must be 12,000 characters or fewer.' } }, 413, origin);

    let upstream;
    try {
      upstream = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': SITE_URL,
          'X-OpenRouter-Title': 'Logical Steps Dashboard',
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.1,
          max_tokens: 2200,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt() },
            { role: 'user', content: text },
          ],
        }),
      });
    } catch {
      return reply({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The analysis provider could not be reached.' } }, 502, origin);
    }

    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      console.error('OpenRouter rejected request', { status: upstream.status, body: upstreamText.slice(0, 1000) });
      return reply({ error: { code: 'UPSTREAM_ERROR', message: 'The analysis provider rejected the request.', upstreamStatus: upstream.status } }, 502, origin);
    }

    try {
      const payload = JSON.parse(upstreamText);
      const modelJson = parseModelJson(payload?.choices?.[0]?.message?.content);
      return reply(normalizeAnalysis(modelJson, text, Date.now() - started), 200, origin);
    } catch (error) {
      console.error('Invalid model analysis', { message: error instanceof Error ? error.message : 'Unknown error' });
      return reply({ error: { code: 'INVALID_ANALYSIS', message: 'The provider returned an invalid logical map.' } }, 502, origin);
    }
  },
};
