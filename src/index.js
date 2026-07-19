const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openai/gpt-4o-mini";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "https://amy2213.github.io",
]);

function getCorsHeaders(origin) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : null;

  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",