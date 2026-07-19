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
  'therefore