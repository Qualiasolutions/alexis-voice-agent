# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alexis is a multilingual VAPI voice agent for armenius.cy PrestaShop e-commerce support. It handles customer inquiries about orders, product stock, tracking, and support tickets in Greek, Russian, and English.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VAPI Voice Platform                       │
│  Gladia Solaria (STT) → Gemini 2.0 Flash → Cartesia (TTS)   │
└────────────────────────┬────────────────────────────────────┘
                         │ Tool calls
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Worker (src/index.ts)                │
│  - Webhook handler for 5 VAPI tools                         │
│  - 5s timeout on all API calls (AbortController)            │
│  - Carrier name caching (1hr TTL, in-memory Map)            │
│  - TTS-friendly text transformations                        │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
┌─────────────────────────┐        ┌─────────────────────────┐
│  armenius.cy/api        │        │  b2b.armenius.cy/api    │
│  (Main PrestaShop)      │        │  (Stock queries only)   │
└─────────────────────────┘        └─────────────────────────┘
```

**Deployment options:**
- `src/index.ts` - Cloudflare Worker (primary, ~2ms cold start, uses `btoa()` for base64, has 5s timeout + carrier caching)
- `api/webhook.js` - Vercel/Netlify (alternative, uses Node.js `Buffer.from()`, no caching)

## Commands

```bash
# Local development (Cloudflare Worker)
npm run dev                    # wrangler dev → localhost:8787

# Deploy webhook to Cloudflare
npm run deploy                 # wrangler deploy

# Set PrestaShop API key as secret
npm run secret                 # wrangler secret put PRESTASHOP_API_KEY

# Deploy VAPI assistant and tools (saves .vapi-deployment.json)
VAPI_TOKEN=xxx WEBHOOK_URL=https://alexis-webhook.workers.dev npm run deploy:vapi

# Test webhook (default URL: localhost:3000, override with WEBHOOK_URL)
WEBHOOK_URL=http://localhost:8787 npm run test
```

## VAPI Tools

The assistant exposes 5 tools to VAPI (defined in `vapi-config/tools.json`):

| Tool | Purpose |
|------|---------|
| `getOrderStatus` | Lookup by reference (9-char) or email |
| `checkProductStock` | Query stock via B2B endpoint |
| `getTrackingInfo` | Get carrier/tracking number |
| `searchProducts` | Search products by name/ID |
| `createSupportTicket` | Create PrestaShop message (XML POST) |

## PrestaShop API Notes

- Stock queries use B2B endpoint (`PRESTASHOP_B2B_URL`) for reliability
- Order states map from numeric IDs (see `ORDER_STATES` in index.ts:21-41)
- Product names are multilingual arrays - extract `id=1` for English
- Support tickets require XML POST with CDATA wrapping (not JSON)
- Filter format: `filter[field]=[value]` or `filter[field]=%value%` for LIKE queries
- Use `display=[field1,field2]` to minimize response size (avoid `display=full`)

## Environment Variables

| Variable | Where Set | Purpose |
|----------|-----------|---------|
| `PRESTASHOP_API_KEY` | Cloudflare secret | API authentication (Basic auth, key as username) |
| `PRESTASHOP_URL` | wrangler.toml | Main shop API (armenius.cy) |
| `PRESTASHOP_B2B_URL` | wrangler.toml | B2B API for stock queries |
| `VAPI_TOKEN` | Local env | For deploy:vapi script only |
| `WEBHOOK_URL` | Local env | For deploy:vapi and test scripts |

## Key Implementation Details

**File locations:**
- Tool handler functions: `src/index.ts:142-401` (getOrderStatus, checkProductStock, getTrackingInfo, searchProducts, createSupportTicket)
- Order states mapping: `src/index.ts:21-41`
- TTS helpers: `src/index.ts:96-139`

**TTS Optimization (`makeSpeechFriendly`):** Transforms product names for natural speech:
- "16GB" → "16 gigabytes"
- "DDR4" → "D D R 4"
- "i5-1145G7" → "i5 1145 G 7"

**Listing Optimization (`shortenForListing`):** Truncates product names for voice listings - keeps brand + model, drops specs.

**Carrier Caching:** In-memory Map with 1hr TTL persists across requests in the same Worker isolate. Refreshes all carriers in a single call.

**Response Format:** VAPI expects tool results in this structure:
```json
{
  "results": [{
    "toolCallId": "call-id",
    "result": "{\"success\": true, ...}"
  }]
}
```

Non-tool-call webhook events should return `{ "ok": true }` immediately.

**VAPI deployment state:** `npm run deploy:vapi` saves assistant/tool IDs to `.vapi-deployment.json` for subsequent updates.

## Debugging & Diagnostics

```bash
# Full VAPI diagnostics (assistants, phones, calls, recommendations)
VAPI_TOKEN=xxx npm run debug

# Analyze a specific call for latency/errors
VAPI_TOKEN=xxx npm run debug:call <call-id>

# Telnyx phone number diagnostics
VAPI_TOKEN=xxx npm run debug:telnyx
VAPI_TOKEN=xxx TELNYX_API_KEY=xxx npm run debug:telnyx  # Full mode

# Test webhook latency (run wrangler dev first)
WEBHOOK_URL=http://localhost:8787 npm run debug:latency
```

### Voice Stack Configuration

```json
{
  "transcriber": {
    "provider": "gladia",
    "model": "solaria-1",
    "languageBehaviour": "automatic multiple languages"
  },
  "model": {
    "provider": "google",
    "model": "gemini-2.0-flash",
    "temperature": 0.7,
    "maxTokens": 250
  },
  "voice": {
    "provider": "cartesia",
    "voiceId": "b45eba5b-2215-4da7-9c7c-121c95ed7b81",
    "model": "sonic-multilingual"
  }
}
```

**Why this stack:**
- **Gladia Solaria**: Only STT with Greek + Russian + English code-switching (Deepgram `multi` mode lacks Greek)
- **Gemini 2.0 Flash**: Fast (~150ms), multilingual, good for e-commerce
- **Cartesia**: Greek voice `b45eba5b-...` with `sonic-multilingual` for all 3 languages

### Latency Budget (target < 700ms total)
| Component | Target | Notes |
|-----------|--------|-------|
| Transcription (Gladia Solaria) | ~270ms | Best for Greek multilingual |
| Webhook (PrestaShop API) | < 200ms | Cached carriers help |
| LLM (Gemini 2.0 Flash) | ~150ms | Short prompts faster |
| TTS (Cartesia sonic-multilingual) | ~90ms | Streaming helps |
| Network overhead | ~50-100ms | Varies by region |
| **Total** | ~500-550ms | Within budget |

### Common Issues
- **High cold start**: Normal for serverless, ~50-200ms on Cloudflare
- **Slow PrestaShop**: Use `display=[fields]` not `display=full`
- **Telnyx no audio**: Re-import phone number in VAPI dashboard, check SIP in Telnyx portal
- **No tools attached**: Run `npm run deploy:vapi` to attach tools to assistant
- **Wrong language detected**: Gladia handles Greek/Russian/English automatically
