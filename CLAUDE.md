# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alexis is a multilingual Retell AI voice agent for armenius.cy PrestaShop e-commerce support. It handles customer inquiries about orders, product stock, tracking, and support tickets in Greek (primary), Russian, and English.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Retell AI Platform                        │
│  Deepgram Nova-3 (STT) → GPT-4o (LLM) → Theos Voice (TTS)   │
└────────────────────────┬────────────────────────────────────┘
                         │ Tool calls via webhook
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Worker (src/index.ts)                │
│  - Path-based routing: /retell/{toolName}                   │
│  - 5 custom tools for PrestaShop integration                │
│  - 5s timeout on all API calls (AbortController)            │
│  - Rate limiting (100 req/min per IP, sliding window)       │
│  - Carrier name caching (1hr TTL, in-memory Map)            │
│  - TTS-friendly text transformations                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────────┐
              │  armenius.cy/api        │
              │  (PrestaShop REST API)  │
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

# Deploy Retell LLM and Agent (saves .retell-deployment.json)
RETELL_API_KEY=xxx WEBHOOK_URL=https://alexis-webhook.workers.dev npm run deploy:retell

# Set PrestaShop API key as secret
npm run secret                 # wrangler secret put PRESTASHOP_API_KEY

# Test webhook endpoints
npm run test

# Run unit tests
npm run test:unit
```

## Retell Tools

The agent exposes 5 tools via path-based routing (defined in `retell-config/alexis-llm.json`):

| Tool | Endpoint | Purpose |
|------|----------|---------|
| `getOrderStatus` | `/retell/getOrderStatus` | Lookup by reference (9-char) or email |
| `checkProductStock` | `/retell/checkProductStock` | Query stock via main shop |
| `getTrackingInfo` | `/retell/getTrackingInfo` | Get carrier/tracking number |
| `searchProducts` | `/retell/searchProducts` | Multi-strategy search with fallbacks |
| `createSupportTicket` | `/retell/createSupportTicket` | Create PrestaShop message (XML POST) |

## PrestaShop API Notes

- All queries use main shop endpoint (`PRESTASHOP_URL`)
- Order states map from numeric IDs (see `ORDER_STATES` in index.ts)
- Product names are multilingual arrays - extract `id=1` for English
- Support tickets require XML POST with CDATA wrapping (not JSON)
- **Product search**: Uses multi-strategy search with query normalization
- **Stock queries**: Use `filter[id_product]=[ID]&filter[id_product_attribute]=[0]` with bracket syntax
- Use `display=[field1,field2]` to minimize response size (avoid `display=full`)

## Environment Variables

| Variable | Where Set | Purpose |
|----------|-----------|---------|
| `PRESTASHOP_API_KEY` | Cloudflare secret | API authentication (Basic auth, key as username) |
| `PRESTASHOP_URL` | wrangler.toml | Main shop API (armenius.cy) |
| `RETELL_API_KEY` | Local env / secret | For deploy:retell script and signature verification |
| `WEBHOOK_URL` | Local env | For deploy:retell script |

**Setting secrets:**
```bash
npx wrangler secret put PRESTASHOP_API_KEY    # PrestaShop API key
npx wrangler secret put RETELL_API_KEY        # From Retell dashboard
```

## Key Implementation Details

**File locations:**
- Tool handlers: `src/index.ts:461-1003` (getOrderStatus, checkProductStock, getTrackingInfo, searchProducts, createSupportTicket)
- Order states mapping: `src/index.ts:68-88`
- TTS helpers: `src/index.ts:400-443` (makeSpeechFriendly, shortenForListing)
- Retell config: `retell-config/alexis-llm.json`, `retell-config/alexis-agent.json`

**TTS Optimization (`makeSpeechFriendly`):** Transforms product names for natural speech:
- "16GB" → "16 gigabytes"
- "DDR4" → "D D R 4"
- "i5-1145G7" → "i5 1145 G 7"

**Multi-Strategy Product Search (`searchProducts`):** Handles fuzzy user queries with fallbacks:
- Query normalization: removes stop words, extracts significant terms
- GPU series expansion: "rtx 50 series" → searches for RTX 5060, 5070, 5080, 5090
- Memory/storage variations: "16gb" → tries "16GB", "16 GB"
- Brand preservation: recognizes 30+ tech brands (nvidia, asus, corsair, etc.)
- Parallel search: tries up to 6 search variations in parallel batches

**Rate Limiting:** Sliding window algorithm (100 requests/minute per IP):
- Uses `cf-connecting-ip` header for client identification
- Returns 429 with `Retry-After`, `X-RateLimit-*` headers when exceeded

**Response Format:** Retell expects tool results as plain JSON (not wrapped):
```json
{
  "success": true,
  "products": [...],
  "note": "..."
}
```

## Retell Configuration

**Agent:** `agent_b1ac0f8e5864bbff51b79409fc`
**LLM:** `llm_d4567a4cdb3c0555df0cd5ccb357`
**Phone:** `+35722056178` (Cyprus, via Telnyx SIP)

**Voice Stack:**
- STT: Deepgram Nova-3
- LLM: GPT-4o (temperature 0.7)
- TTS: Custom voice (Theos - `custom_voice_61664f889f1e0c32642f753577`)
- Primary language: Greek (el-GR)

**Deployment state:** `npm run deploy:retell` saves LLM/agent IDs to `.retell-deployment.json` for subsequent updates.

## Debugging

```bash
# Test webhook latency (run wrangler dev first)
WEBHOOK_URL=http://localhost:8787 npm run debug:latency

# Telnyx phone number diagnostics
TELNYX_API_KEY=xxx npm run debug:telnyx

# View Cloudflare Worker logs
npx wrangler tail alexis-webhook
```

### Latency Budget (target < 700ms total)
| Component | Target | Notes |
|-----------|--------|-------|
| Transcription (Deepgram) | ~150ms | Fast multilingual |
| Webhook (PrestaShop API) | < 200ms | Cached carriers help |
| LLM (GPT-4o) | ~200ms | Short prompts faster |
| TTS (custom voice) | ~100ms | Streaming helps |
| **Total** | ~550-650ms | Within budget |

### Common Issues
- **High cold start**: Normal for serverless, ~50-200ms on Cloudflare
- **Slow PrestaShop**: Use `display=[fields]` not `display=full`
- **Phone not answering**: Check Telnyx FQDN connection points to `sip.retellai.com`
- **Wrong language**: Agent language set to `el-GR` (Greek primary)
