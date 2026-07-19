# Logical Steps API

Secure Cloudflare Worker gateway for the Logical Steps Dashboard.

## Architecture

```text
GitHub Pages frontend
        ↓
Cloudflare Worker
        ↓
OpenRouter API
```

The browser never receives the OpenRouter API key. The Worker reads it from the Cloudflare secret binding `OPENROUTER_API_KEY`.

## Public endpoints

- `GET /health`
- `POST /v1/analyze`

Production Worker URL:

```text
https://logical-steps-api.logicalstepsdash.workers.dev
```

Allowed browser origins:

- `http://localhost:5173`
- `https://amy2213.github.io`

## Local setup

```powershell
npm install
npx wrangler login
npx wrangler secret put OPENROUTER_API_KEY
npm run dev
```

For local-only secrets, use `.dev.vars`. Never commit that file.

## Deploy

```powershell
npm install
npm run deploy
```

## Test

```powershell
Invoke-RestMethod `
  -Uri "https://logical-steps-api.logicalstepsdash.workers.dev/health" `
  -Method Get
```

Then test analysis:

```powershell
$body = @{
  text = "Remote work may improve productivity because workers face fewer interruptions. Therefore, companies should permit remote work when job duties allow it."
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://logical-steps-api.logicalstepsdash.workers.dev/v1/analyze" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

## Security rules

- Never commit an OpenRouter key.
- Never expose the key through a `VITE_*` variable.
- Never call OpenRouter directly from GitHub Pages.
- Store the production key only with `wrangler secret put OPENROUTER_API_KEY`.
- Rotate any key that appears in source, documents, logs, screenshots, or chat.
