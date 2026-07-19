const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';
const SITE_URL = 'https://amy2213.github.io/logical-steps-dashboard/';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'https://amy2213.github.io',
]);

const ALLOWED_ROLES = new Set([
  'context',
  'premise',
  'conclusion',
  'assumption',
  'counterpoint',
]);

const ALLOWED_CONNECTIVES = new Set([
  'because',
  'therefore',
  'unless',
  'but',
  'if/then',
]);

function corsHeaders(origin) {
  return {
    ...(origin && ALLOWED_ORIGINS.has(origin)
      ? { 'Access-Control-Allow-Origin': origin }
      : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

function validateModelAnalysis(value, sourceText) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Analysis must be an object.');
  }

  if (typeof value.gist !== 'string' || !value.gist.trim()) {
    throw new Error('Analysis gist is missing.');
  }

  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    throw new Error('Analysis nodes are missing.');
  }

  const ids = new Set();

  for (const node of value.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('Every node must be an object.');
    }
    if (typeof node.id !== 'string' || !node.id.trim() || ids.has(node.id)) {
      throw new Error('Node IDs must be present and unique.');
    }
    ids.add(node.id);
    if (!ALLOWED_ROLES.has(node.role)) {
      throw new Error(`Unknown node role: ${node.role}`);
    }
    if (typeof node.plain !== 'string' || !node.plain.trim()) {
      throw new Error('Every node requires plain text.');
    }
    if (typeof node.original !== 'string') {
      throw new Error('Every node requires original text.');
    }
    if (!Array.isArray(node.dependsOn)) {
      throw new Error('Every node requires a dependsOn array.');
    }
    if (node.connective != null && !ALLOWED_CONNECTIVES.has(node.connective)) {
      throw new Error(`Unknown connective: ${node.connective}`);
    }
    if (
      node.confidence != null &&
      (typeof node.confidence !== 'number' || node.confidence < 0 || node.confidence > 1)
    ) {
      throw new Error('Confidence must be between 0 and 1.');
    }
  }

  for (const node of value.nodes) {
    for (const dependencyId of node.dependsOn) {
      if (!ids.has(dependencyId) || dependencyId === node.id) {
        throw new Error('Node dependencies are invalid.');
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    sourceText,
    gist: value.gist.trim(),
    nodes: value.nodes,
    meta: {
      model: MODEL,
      elapsedMs: 0,
      stageTimings: {},
    },
  };
}

function systemPrompt() {
  return `
You are the analysis engine for Logical Steps Dashboard.
Convert dense text into a faithful logical map for neurodivergent readers.
Return JSON only, with no Markdown fences or commentary.

Return exactly this shape:
{
  "gist": "A concise conversational summary",
  "nodes": [
    {
      "id": "n1",
      "role": "context | premise | conclusion | assumption | counterpoint",
      "plain": "Clear conversational wording",
      "original": "Exact supporting wording copied from the source, or an empty string for an inferred assumption",
      "connective": "because | therefore | unless | but | if/then",
      "dependsOn": [],
      "confidence": 0.9
    }
  ]
}

Rules:
- Preserve material qualifiers and uncertainty.
- Never present inferred content as explicit source text.
- Use role "assumption" only for an unstated logical requirement, and set original to an empty string.
- Use role "counterpoint" for objections or opposing views.
- Use exact source wording in original whenever the node is explicit.
- Use unique node IDs.
- All dependsOn IDs must exist and cannot point to the same node.
- Omit connective when no listed connective fits.
- Confidence must be between 0 and 1.
- Do not claim the argument is factually true; map only what the text says and implies.
`.trim();
}

export default {
  async fetch(request, env) {
    const started = Date.now();
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      if (!origin || !ALLOWED_ORIGINS.has(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, service: 'logical-steps-api' }, 200, origin);
    }

    if (url.pathname !== '/v1/analyze' || request.method !== 'POST') {
      return json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json(
        { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin is not allowed.' } },
        403,
        origin,
      );
    }

    if (!env.OPENROUTER_API_KEY) {
      return json(
        { error: { code: 'SERVER_CONFIGURATION_ERROR', message: 'The analysis service is not configured.' } },
        500,
        origin,
      );
    }

    let requestBody;
    try {
      requestBody = await request.json();
    } catch {
      return json(
        { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
        400,
        origin,
      );
    }

    const text = typeof requestBody?.text === 'string' ? requestBody.text.trim() : '';

    if (!text) {
      return json(
        { error: { code: 'INVALID_TEXT', message: 'A non-empty text field is required.' } },
        400,
        origin,
      );
    }

    if (text.length > 12000) {
      return json(
        { error: { code: 'TEXT_TOO_LONG', message: 'Text must be 12,000 characters or fewer.' } },
        413,
        origin,
      );
    }

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
  provider: {
    require_parameters: true,
  },
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'logical_steps_analysis',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['gist', 'nodes'],
        properties: {
          gist: {
            type: 'string',
            minLength: 1,
          },
          nodes: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'id',
                'role',
                'plain',
                'original',
                'dependsOn',
              ],
              properties: {
                id: {
                  type: 'string',
                  minLength: 1,
                },
                role: {
                  type: 'string',
                  enum: [
                    'context',
                    'premise',
                    'conclusion',
                    'assumption',
                    'counterpoint',
                  ],
                },
                plain: {
                  type: 'string',
                  minLength: 1,
                },
                original: {
                  type: 'string',
                },
                connective: {
                  type: 'string',
                  enum: [
                    'because',
                    'therefore',
                    'unless',
                    'but',
                    'if/then',
                  ],
                },
                dependsOn: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                },
              },
            },
          },
        },
      },
    },
  },
  messages: [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: text },
  ],
}),
    } catch {
      return json(
        { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The analysis provider could not be reached.' } },
        502,
        origin,
      );
    }

    const upstreamText = await upstream.text();

    if (!upstream.ok) {
      console.error('OpenRouter rejected request', { status: upstream.status });
      return json(
        {
          error: {
            code: 'UPSTREAM_ERROR',
            message: 'The analysis provider rejected the request.',
            upstreamStatus: upstream.status,
          },
        },
        502,
        origin,
      );
    }

    let payload;
    try {
      payload = JSON.parse(upstreamText);
    } catch {
      return json(
        { error: { code: 'INVALID_UPSTREAM_RESPONSE', message: 'The provider returned malformed data.' } },
        502,
        origin,
      );
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return json(
        { error: { code: 'EMPTY_MODEL_RESPONSE', message: 'The provider returned no analysis.' } },
        502,
        origin,
      );
    }

    try {
      const modelAnalysis = JSON.parse(content);
      const analysis = validateModelAnalysis(modelAnalysis, text);
      analysis.meta.elapsedMs = Date.now() - started;
      return json(analysis, 200, origin);
    } catch (error) {
      console.error('Invalid model analysis', {
        message: error instanceof Error ? error.message : 'Unknown validation error',
      });
      return json(
        { error: { code: 'INVALID_ANALYSIS', message: 'The provider returned an invalid logical map.' } },
        502,
        origin,
      );
    }
  },
};
