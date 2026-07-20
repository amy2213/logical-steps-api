const OPENROUTER_URL='https://openrouter.ai/api/v1/chat/completions';
const TURNSTILE_URL='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MODEL='openai/gpt-4o-mini';
const SITE_URL='https://amy2213.github.io/logical-steps-dashboard/';
const ORIGINS=new Set(['http://localhost:5173','https://amy2213.github.io']);
const ROLES=new Set(['context','premise','conclusion','assumption','counterpoint']);
const CONNECTIVES=new Set(['because','there