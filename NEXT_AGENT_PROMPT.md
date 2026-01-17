# Alexis Voice Agent - Next Agent Prompt

## Project Context

You are continuing work on **Alexis**, a VAPI voice agent for armenius.cy PrestaShop e-commerce support. The previous agent completed a comprehensive brownfield exploration, production audit, full code review, and deployed fixes.

**Project Location:** `/home/qualia/Desktop/Projects/voice/alexis`

---

## What Was Done (Previous Session)

### Completed Tasks
1. **Brownfield Exploration** - Full architecture mapping
2. **Production Audit** - 4 parallel Opus agents (security, performance, reliability, deployment)
3. **Full Code Review** - Code quality, architecture, test coverage, simplicity analysis
4. **7 Fixes Applied:**
   - CORS restricted from `*` to `https://api.vapi.ai` (`src/index.ts:701-710`)
   - Test script VAPI format fixed (`scripts/test-webhook.js:8-21`)
   - Test script URL path fixed (`scripts/test-webhook.js:25,56`)
   - Stock query optimized `display=full` → `display=[quantity]` (`src/index.ts:417,445`)
   - Product ID validation added (`src/index.ts:436-439`)
   - Correlation ID logging added (`src/index.ts:790`)
   - Phone lookups parallelized (`src/index.ts:298-312`)
5. **Deployed to Cloudflare:** `https://alexis-webhook.yellow-mountain-8da2.workers.dev`

### Audit Score After Fixes: ~90/100 (was 82/100)

---

## Key Files to Read

| File | Purpose |
|------|---------|
| `/home/qualia/Desktop/Projects/voice/alexis/CLAUDE.md` | Project documentation, architecture, commands |
| `/home/qualia/Desktop/Projects/voice/alexis/src/index.ts` | Main Cloudflare Worker (~805 lines) |
| `/home/qualia/Desktop/Projects/voice/alexis/vapi-config/alexis-assistant.json` | VAPI assistant config |
| `/home/qualia/Desktop/Projects/voice/alexis/vapi-config/tools.json` | 5 VAPI tool definitions |
| `/home/qualia/Desktop/Projects/voice/alexis/scripts/test-webhook.js` | Fixed test script |
| `/home/qualia/Desktop/Projects/voice/alexis/wrangler.toml` | Cloudflare Worker config |
| `/home/qualia/.claude/plans/sunny-wondering-ullman.md` | Full audit report with all findings |

---

## Remaining Tasks (Not Yet Done)

### HIGH PRIORITY

#### 1. Set VAPI Webhook Secret (Security)
The webhook signature verification is implemented but optional. Make it mandatory.

**Steps:**
```bash
# Set the secret in Cloudflare
npx wrangler secret put VAPI_WEBHOOK_SECRET
# Enter the secret from VAPI dashboard when prompted

# Then update src/index.ts lines 743-750 to fail if secret not configured:
# Change from optional check to mandatory
```

**Current code at `src/index.ts:743-750`:**
```typescript
// Webhook authentication (if secret is configured)
if (env.VAPI_WEBHOOK_SECRET) {
  const isValid = await verifyWebhookSignature(request, bodyText, env.VAPI_WEBHOOK_SECRET);
  if (!isValid) {
    console.warn('Webhook signature verification failed');
    return new Response(UNAUTHORIZED, { status: 401, headers: JSON_HEADERS });
  }
}
```

**Should become:**
```typescript
// Webhook authentication (mandatory in production)
if (!env.VAPI_WEBHOOK_SECRET) {
  console.error('VAPI_WEBHOOK_SECRET not configured');
  return new Response(INTERNAL_ERROR, { status: 500, headers: JSON_HEADERS });
}
const isValid = await verifyWebhookSignature(request, bodyText, env.VAPI_WEBHOOK_SECRET);
if (!isValid) {
  console.warn('Webhook signature verification failed');
  return new Response(UNAUTHORIZED, { status: 401, headers: JSON_HEADERS });
}
```

#### 2. Enable Cloudflare Rate Limiting
No rate limiting exists on the webhook endpoint.

**Steps:**
1. Go to Cloudflare Dashboard → alexis-webhook Worker
2. Settings → Rate Limiting Rules
3. Add rule: 100 requests per minute per IP
4. Document in CLAUDE.md

#### 3. Add Unit Tests (Test Coverage ~5%)
No test framework installed. Need Vitest for Cloudflare Workers.

**Steps:**
```bash
npm install -D vitest @cloudflare/vitest-pool-workers
```

**Priority tests to write:**
1. `isValidOrderReference()` - Input validation
2. `isValidEmail()` - Input validation
3. `escapeCdata()` - XML security (critical)
4. `sanitizeSearchQuery()` - Filter injection prevention
5. `makeSpeechFriendly()` - TTS transformations
6. `shortenForListing()` - Product name truncation

**Test file location:** `__tests__/unit/helpers.test.ts`

---

### MEDIUM PRIORITY

#### 4. Extract Stock Result Formatting Helper (DRY Fix)
Duplicate code at `src/index.ts:422-432` and `src/index.ts:454-464`.

**Create helper:**
```typescript
function formatStockResult(productId: number, productName: string, quantity: number) {
  return {
    success: true,
    product_id: productId,
    name: productName,
    quantity,
    in_stock: quantity > 0,
    message: quantity > 0
      ? `We have ${quantity} units in stock. Please check the product page for delivery times.`
      : 'Sorry, this product is currently out of stock',
    note: 'Stock availability does not guarantee instant delivery. Check product page for delivery times.'
  };
}
```

#### 5. Remove Unused B2B URL Support
`PRESTASHOP_B2B_URL` is defined but never used.

**Files to modify:**
- `src/index.ts:17` - Remove from Env interface
- `src/index.ts:169-170` - Remove useB2B parameter from prestashopFetch
- `wrangler.toml:7` - Remove PRESTASHOP_B2B_URL

#### 6. Fix Misleading Comment
`src/index.ts:376` says "LRU-style eviction" but it's actually FIFO.

**Change comment from:**
```typescript
// Cache with LRU-style eviction
```
**To:**
```typescript
// Cache with FIFO eviction (oldest entry removed when full)
```

---

### LOW PRIORITY (Future)

#### 7. Update Wrangler to v4.x
```bash
npm install -D wrangler@4
```
Resolves npm audit warnings (dev dependencies only, not production risk).

#### 8. Add Structured Logging
Replace console.log with JSON structured logs for better observability.

#### 9. Create PrestaShop Repository Abstraction
Extract API calls into a repository pattern for better testability.

---

## Architecture Reference

```
VAPI Voice Platform (Gladia STT → Gemini 2.0 Flash → Cartesia TTS)
        │
        ▼ HTTP POST (tool-calls webhook)
Cloudflare Worker (src/index.ts)
        │
        ▼ REST API (Basic Auth)
PrestaShop API (armenius.cy/api)
```

### 5 VAPI Tools
| Tool | Location | Purpose |
|------|----------|---------|
| `getOrderStatus` | `src/index.ts:259-357` | Lookup by reference/email/phone |
| `checkProductStock` | `src/index.ts:390-469` | Query stock by ID or name |
| `getTrackingInfo` | `src/index.ts:499-561` | Get carrier/tracking number |
| `searchProducts` | `src/index.ts:570-649` | Search products by name |
| `createSupportTicket` | `src/index.ts:652-704` | Create PrestaShop message |

### Caching
- **Carrier cache:** 1hr TTL, in-memory Map (`src/index.ts:91-94`)
- **Product cache:** 5min TTL, 100 items max, FIFO eviction (`src/index.ts:96-99`)

---

## Commands Reference

```bash
# Development
npm run dev                    # wrangler dev → localhost:8787

# Deploy
npm run deploy                 # wrangler deploy (or npx wrangler deploy)

# Test
npm run test                   # Test webhook locally
WEBHOOK_URL=https://alexis-webhook.yellow-mountain-8da2.workers.dev npm run test

# Secrets
npm run secret                 # Set PRESTASHOP_API_KEY
npx wrangler secret put VAPI_WEBHOOK_SECRET  # Set webhook secret

# Debug
npm run debug                  # Full VAPI diagnostics
npm run debug:latency          # Latency testing
```

---

## Verification Checklist

After making changes:
1. [ ] Run `npm run test` locally with `wrangler dev`
2. [ ] Deploy with `npm run deploy`
3. [ ] Test against production: `WEBHOOK_URL=https://alexis-webhook.yellow-mountain-8da2.workers.dev npm run test`
4. [ ] Check Cloudflare Workers dashboard for errors
5. [ ] Update CLAUDE.md if architecture changed

---

## Don't Forget

- Read `CLAUDE.md` first for full project context
- Read the audit report at `~/.claude/plans/sunny-wondering-ullman.md` for detailed findings
- The codebase uses Cloudflare Workers runtime (not Node.js) - globals like `fetch`, `crypto`, `console` exist
- TypeScript diagnostics showing "Cannot find name 'fetch'" are expected - these are Worker runtime APIs
- All tool handlers have try/catch with user-friendly error messages for voice output
