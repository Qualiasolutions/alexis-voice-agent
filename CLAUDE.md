# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alexis is a multilingual VAPI voice agent for armenius.cy PrestaShop e-commerce support. It handles customer inquiries about orders, product stock, tracking, and support tickets in Greek, Russian, and English.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VAPI Voice Platform                       │
│  Gladia Solaria (STT) → GPT-4o (LLM) → 11labs (TTS)         │
└────────────────────────┬────────────────────────────────────┘
                         │ Tool calls
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Worker (src/index.ts)                │
│  - Webhook handler for 5 VAPI tools                         │
│  - 5s timeout on all API calls (AbortController)            │
│  - Rate limiting (100 req/min per IP, sliding window)       │
│  - Carrier name caching (1hr TTL, in-memory Map)            │
│  - TTS-friendly text transformations                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────────┐
              │  armenius.cy/api        │
              │  (All PrestaShop API)   │
              └─────────────────────────┘
```

**Deployment:** Cloudflare Workers (`src/index.ts`)
- ~2ms cold start, uses `btoa()` for base64
- 5s timeout on all API calls (AbortController)
- In-memory carrier caching (1hr TTL)

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

# Test webhook (requires VAPI_WEBHOOK_SECRET for signed requests)
VAPI_WEBHOOK_SECRET=xxx npm run test

# Run unit tests
npm run test:unit
```

## VAPI Tools

The assistant exposes 5 tools to VAPI (defined in `vapi-config/tools.json`):

| Tool | Purpose |
|------|---------|
| `getOrderStatus` | Lookup by reference (9-char) or email |
| `checkProductStock` | Query stock via main shop |
| `getTrackingInfo` | Get carrier/tracking number |
| `searchProducts` | Search products by name/ID |
| `createSupportTicket` | Create PrestaShop message (XML POST) |

## PrestaShop API Notes

- All queries use main shop endpoint (`PRESTASHOP_URL`)
- Order states map from numeric IDs (see `ORDER_STATES` in index.ts:21-41)
- Product names are multilingual arrays - extract `id=1` for English
- Support tickets require XML POST with CDATA wrapping (not JSON)
- **Product search**: Use `/search?language=1&query=term` endpoint (NOT filter queries on name field - multilingual fields don't support LIKE filters)
- **Stock queries**: Use `filter[id_product]=[ID]&filter[id_product_attribute]=[0]` with bracket syntax
- **Filter syntax** (per [PrestaShop docs](https://devdocs.prestashop-project.org/9/webservice/cheat-sheet/)):
  - Exact match: `filter[field]=value` or `filter[field]=[value]` (bracket syntax for some endpoints)
  - Interval/OR: `filter[field]=[1|5]` or `filter[field]=[1,10]`
- Use `display=[field1,field2]` to minimize response size (avoid `display=full`)

## Environment Variables

| Variable | Where Set | Purpose |
|----------|-----------|---------|
| `PRESTASHOP_API_KEY` | Cloudflare secret | API authentication (Basic auth, key as username) |
| `PRESTASHOP_URL` | wrangler.toml | Main shop API (armenius.cy) |
| `VAPI_WEBHOOK_SECRET` | Cloudflare secret | Optional - HMAC-SHA256 signature verification |
| `VAPI_TOKEN` | Local env | For deploy:vapi script only |
| `WEBHOOK_URL` | Local env | For deploy:vapi and test scripts |

**Setting secrets:**
```bash
npx wrangler secret put PRESTASHOP_API_KEY    # PrestaShop API key
npx wrangler secret put VAPI_WEBHOOK_SECRET   # From VAPI dashboard → Server URL secret
```

## Key Implementation Details

**File locations:**
- Tool handlers: `src/index.ts:144-419` (getOrderStatus, checkProductStock, getTrackingInfo, searchProducts, createSupportTicket)
- Order states mapping: `src/index.ts:21-41`
- TTS helpers: `src/index.ts:96-142` (makeSpeechFriendly, shortenForListing)

**TTS Optimization (`makeSpeechFriendly`):** Transforms product names for natural speech:
- "16GB" → "16 gigabytes"
- "DDR4" → "D D R 4"
- "i5-1145G7" → "i5 1145 G 7"

**Listing Optimization (`shortenForListing`):** Truncates product names for voice listings - keeps brand + model, drops specs.

**Carrier Caching:** In-memory Map with 1hr TTL persists across requests in the same Worker isolate. Refreshes all carriers in a single call.

**Rate Limiting:** Sliding window algorithm (100 requests/minute per IP):
- Uses `cf-connecting-ip` header for client identification
- Returns 429 with `Retry-After`, `X-RateLimit-*` headers when exceeded
- Per-isolate tracking (not shared across Workers)
- Location: `src/index.ts:100-144` (checkRateLimit function)

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
    "languageBehaviour": "automatic multiple languages",
    "languages": ["el", "en", "ru"],
    "confidenceThreshold": 0.2
  },
  "model": {
    "provider": "openai",
    "model": "chatgpt-4o-latest",
    "temperature": 0.7,
    "maxTokens": 250
  },
  "voice": {
    "provider": "11labs",
    "voiceId": "pNInz6obpgDQGcFmaJgB",
    "model": "eleven_turbo_v2_5"
  }
}
```

**Why this stack:**
- **Gladia Solaria**: Only STT with Greek + Russian + English code-switching (Deepgram `multi` mode lacks Greek)
- **GPT-4o**: Fast, multilingual, excellent for e-commerce conversations
- **11labs turbo_v2_5**: Fast male voice (Adam), supports multilingual output

### Latency Budget (target < 700ms total)
| Component | Target | Notes |
|-----------|--------|-------|
| Transcription (Gladia Solaria) | ~270ms | Best for Greek multilingual |
| Webhook (PrestaShop API) | < 200ms | Cached carriers help |
| LLM (GPT-4o) | ~200ms | Short prompts faster |
| TTS (11labs turbo) | ~100ms | Streaming helps |
| Network overhead | ~50-100ms | Varies by region |
| **Total** | ~550-650ms | Within budget |

### Common Issues
- **High cold start**: Normal for serverless, ~50-200ms on Cloudflare
- **Slow PrestaShop**: Use `display=[fields]` not `display=full`
- **Telnyx no audio**: Re-import phone number in VAPI dashboard, check SIP in Telnyx portal
- **No tools attached**: Run `npm run deploy:vapi` to attach tools to assistant
- **Wrong language detected**: Gladia handles Greek/Russian/English automatically
