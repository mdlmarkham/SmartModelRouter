# SmartModelRouter

Intelligent model routing for OpenClaw, AWS Bedrock, OpenAI, and similar LLM gateways. Uses 14-dimension complexity scoring to automatically select the optimal model for each request.

## Features

- **14-Dimension Complexity Scoring** — Analyzes prompts across multiple complexity axes
- **Dynamic Tier Routing** — Automatically routes to SIMPLE, MEDIUM, COMPLEX, or REASONING models
- **Modality Detection** — Detects vision/image requests for MULTIMODAL routing
- **Long Context Detection** — Identifies requests needing large context windows
- **Dynamic Escalation** — Escalates complexity tier mid-conversation (never downgrades)
- **Model Optimization** — Routes simpler requests to cheaper models (10-20x cost savings)
- **Session-Aware** — Tracks conversation complexity across turns
- **Environment-Specific Config** — Tune models for your cloud, costs, and available models

## Accuracy

- **79% accuracy** on calibrated test set
- **100% accuracy** on MULTIMODAL and LONG_CONTEXT detection
- **100% accuracy** on REASONING tier (reasoning-override triggers)
- **12/14 tests passing** (MEDIUM vs COMPLEX both route to same Sonnet model)

## Quick Start

1. **Install** the package:
   ```bash
   npm install @openclaw/smart-router
   ```

2. **Test routing** (uses defaults):
   ```bash
   node test-standalone.js
   ```

3. **(Optional)** Create `config.json` if defaults don't match your setup:
   ```json
   { "models": { "SIMPLE": "your-cheap-model", "MEDIUM": "your-mid-model" } }
   ```

4. **Verify routing** — Send "What is gravity?" and check it routes to SIMPLE tier.

## Tier Boundaries

| Tier | Score Range | Typical Use Case |
|------|-------------|------------------|
| SIMPLE | < 0.08 | Trivia, greetings, definitions |
| MEDIUM | 0.08 - 0.32 | Explanations, summaries |
| COMPLEX | 0.32 - 0.58 | Implementations, architecture |
| REASONING | ≥ 0.58 | Proofs, formal logic |

## Model Capability Notes

When selecting models for each tier, consider:

| Tier | Requirements | Good Choices |
|------|--------------|--------------|
| SIMPLE | Any model works | Faster/cheaper is better |
| MEDIUM | Balanced quality/cost | claude-sonnet, gpt-4.1 |
| COMPLEX | Strong reasoning | claude-sonnet, gpt-4.1, glm-5 |
| REASONING | Chain-of-thought optimized | claude-opus, o1, deepseek-r1 |
| MULTIMODAL | **Must support vision** | llava, gpt-4.1, claude-sonnet, kimi-k2.5 |
| LONG_CONTEXT | **Must support >100k tokens** | claude-sonnet, gemini-pro |
| FALLBACK | Largest available | claude-opus, o1 |

## Installation

### As OpenClaw Plugin (Recommended)

1. **Clone or download** the plugin:
   ```bash
   cd ~/.openclaw/extensions
   git clone https://github.com/mdlmarkham/SmartModelRouter.git smart-router
   ```

2. **Restart OpenClaw gateway** to load the plugin:
   ```bash
   systemctl --user restart openclaw-gateway
   # or
   pkill -f openclaw-gateway && cd /usr/lib/node_modules/openclaw && node openclaw.mjs start
   ```

3. **Verify plugin loaded** — check logs for:
   ```
   [smart-router] Plugin initializing...
   [smart-router] Hook registered: before_model_resolve via api.on()
   ```

4. **Configure models** for your environment — see [Configuration](#configuration) below

5. **Test routing** — send a simple message and check logs output:
   ```
   [smart-router] Route: tier=SIMPLE → glm-4.7:cloud
   ```

### Via npm

```bash
npm install @openclaw/smart-router
```

Or copy the files to your OpenClaw extensions directory:
```bash
cp -r ./* /path/to/openclaw/extensions/smart-router/
```

### File Locations

After installation, files are located at:

| Install Method | Location |
|----------------|----------|
| npm global | `$(npm root -g)/@openclaw/smart-router/` |
| npm local | `./node_modules/@openclaw/smart-router/` |
| OpenClaw extensions | `/root/.openclaw/extensions/smart-router/` |
| Custom path | Set `SMART_ROUTER_CONFIG_PATH` env var |

## Configuration

### Default Models (Source)

The defaults in `router-modality.cjs` are a neutral starting point — AWS Bedrock cross-region profiles. **For production use, override via `config.json` to match your environment.**

| Tier | Default Model |
|------|---------------|
| SIMPLE | amazon-bedrock/us.amazon.nova-lite-v1:0 |
| MEDIUM | amazon-bedrock/us.anthropic.claude-sonnet-4-6 |
| COMPLEX | amazon-bedrock/us.anthropic.claude-sonnet-4-6 |
| REASONING | amazon-bedrock/us.anthropic.claude-opus-4-6-v1 |
| MULTIMODAL | amazon-bedrock/us.anthropic.claude-sonnet-4-6 |
| LONG_CONTEXT | amazon-bedrock/us.anthropic.claude-sonnet-4-6 |
| FALLBACK | amazon-bedrock/us.anthropic.claude-opus-4-6-v1 |

---

### Model Name Formats

Different providers use different model identifier formats:

| Provider | Format | Example |
|----------|--------|---------|
| AWS Bedrock | `amazon-bedrock/<profile>` | `us.anthropic.claude-sonnet-4-6` |
| OpenAI | `openai/<model>` | `gpt-4.1`, `o1` |
| Anthropic Direct | `anthropic/<model>` | `claude-sonnet-4-6` |
| Ollama Cloud | `<model>:cloud` | `glm-5:cloud` |
| Local Ollama | `<model>:<tag>` | `llama3.2:3b`, `llama3.2:latest` |

---

### Customizing Models for Your Environment

The defaults may not match your available models, budget, or quality preferences. Use `config.json` to tune per-tier models.

#### config.json (Recommended)

Create `config.json` in the extension directory (same location as `router-modality.cjs`):

```bash
# For OpenClaw extensions
/path/to/openclaw/extensions/smart-router/config.json
```

**AWS Bedrock (with Haiku for MEDIUM):**
```json
{
  "models": {
    "SIMPLE": "amazon-bedrock/us.amazon.nova-lite-v1:0",
    "MEDIUM": "amazon-bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "COMPLEX": "amazon-bedrock/us.anthropic.claude-sonnet-4-6",
    "REASONING": "amazon-bedrock/us.anthropic.claude-opus-4-6-v1",
    "MULTIMODAL": "amazon-bedrock/us.anthropic.claude-sonnet-4-6",
    "LONG_CONTEXT": "amazon-bedrock/us.anthropic.claude-sonnet-4-6",
    "FALLBACK": "amazon-bedrock/us.anthropic.claude-opus-4-6-v1"
  }
}
```

**OpenAI:**
```json
{
  "models": {
    "SIMPLE": "openai/gpt-4.1-mini",
    "MEDIUM": "openai/gpt-4.1",
    "COMPLEX": "openai/gpt-4.1",
    "REASONING": "openai/o1",
    "MULTIMODAL": "openai/gpt-4.1",
    "LONG_CONTEXT": "openai/gpt-4.1",
    "FALLBACK": "openai/o1"
  }
}
```

**Ollama Cloud:**
```json
{
  "models": {
    "SIMPLE": "nemotron-3-nano:30b-cloud",
    "MEDIUM": "glm-4.7:cloud",
    "COMPLEX": "glm-5:cloud",
    "REASONING": "minimax-m2.7:cloud",
    "MULTIMODAL": "kimi-k2.5:cloud",
    "LONG_CONTEXT": "nemotron-3-super:cloud",
    "FALLBACK": "mistral-large-3:675b-cloud"
  }
}
```

**Local Ollama:**
```json
{
  "models": {
    "SIMPLE": "llama3.2:3b",
    "MEDIUM": "llama3.2:latest",
    "COMPLEX": "llama3.3:70b",
    "REASONING": "deepseek-r1:8b",
    "MULTIMODAL": "llava:13b",
    "LONG_CONTEXT": "llama3.3:70b",
    "FALLBACK": "llama3.3:70b"
  }
}
```

---

#### Priority Order

**Each tier is resolved independently.** You can mix configuration methods:

```bash
# Override just REASONING via env, keep others in config
export SMART_ROUTER_REASONING_MODEL="openai/o1"
# config.json sets SIMPLE, MEDIUM, COMPLEX, etc.
```

Priority per-tier:
1. **Environment variable** — `SMART_ROUTER_<TIER>_MODEL` (highest)
2. **config.json** — File-based configuration
3. **Source defaults** — Hardcoded in `router-modality.cjs` (lowest)

#### Environment Variables

When file-based config isn't convenient (containers, serverless):

```bash
# Per-tier model overrides
export SMART_ROUTER_SIMPLE_MODEL="your-cheap-model"
export SMART_ROUTER_MEDIUM_MODEL="your-mid-model"
export SMART_ROUTER_COMPLEX_MODEL="your-capable-model"
export SMART_ROUTER_REASONING_MODEL="your-reasoning-model"
export SMART_ROUTER_MULTIMODAL_MODEL="your-vision-model"
export SMART_ROUTER_LONG_CONTEXT_MODEL="your-large-context-model"
export SMART_ROUTER_FALLBACK_MODEL="your-fallback-model"
```

---

## Troubleshooting

### How do I know which tier a request routed to?

Use the `classifyRequest()` function and check the result:

```javascript
const { classifyRequest } = require('./router-modality.cjs');
const result = classifyRequest("What is gravity?");
console.log(result.tier);       // 'SIMPLE'
console.log(result.model);      // 'amazon-bedrock/us.amazon.nova-lite-v1:0'
console.log(result.modelSource); // 'default', 'config', or 'env'
console.log(result.confidence);  // 0.95
console.log(result.score);      // 0.03
```

### What if the model is not found?

Verify the model name format matches your provider. Check `result.model` after classification and compare against your provider's model list.

### Can I disable dynamic routing?

Set all tiers to the same model in config.json to effectively disable routing:

```json
{
  "models": {
    "SIMPLE": "openai/gpt-4.1",
    "MEDIUM": "openai/gpt-4.1",
    "COMPLEX": "openai/gpt-4.1",
    "REASONING": "openai/gpt-4.1",
    "MULTIMODAL": "openai/gpt-4.1",
    "LONG_CONTEXT": "openai/gpt-4.1",
    "FALLBACK": "openai/gpt-4.1"
  }
}
```

### How do I test my configuration?

Run the test suite:

```bash
node test-standalone.js
node -e "const r = require('./router-modality.cjs'); console.log(r.resolveActiveTiers());"
```

### Why is my request routing to the wrong tier?

1. Check the score: `classifyRequest(prompt).score`
2. Review tier boundaries (default: 0.08, 0.32, 0.58)
3. Adjust thresholds in config.json if needed
4. Check for keywords triggering reasoning override

---

## Complexity Dimensions

1. **tokenCount** — Request length
2. **codePresence** — Code keywords (function, class, implement, refactor, debug)
3. **reasoningMarkers** — Reasoning keywords (prove that, theorem, derive, formally)
4. **technicalTerms** — Technical vocabulary
5. **creativeMarkers** — Creative requests (story, poem, summarize, summary of)
6. **simpleIndicators** — Simple queries (what is, define, hello) — **FIXED: positive score with negative weight**
7. **multiStepPatterns** — Multi-step tasks (first...then)
8. **questionComplexity** — Question depth
9. **imperativeVerbs** — Action verbs (build, create, implement)
10. **constraintCount** — Constraints (must be, without)
11. **outputFormat** — Format requirements (JSON, table)
12. **referenceComplexity** — Citations, URLs
13. **negationComplexity** — Negations (not, never)
14. **agenticTask** — Tool usage requests

## Key Bug Fixes

### simpleIndicators Double-Negative (Fixed)

**Problem:** Original code had `score: -1.0` with `weight: -0.20`, causing simple queries to *increase* complexity instead of decreasing it.

**Fix:** Changed to `score: 0.5-1.0` (positive) with `weight: -0.20` (negative), so:
- `0.5 * -0.20 = -0.10` (correctly decreases score)
- `1.0 * -0.20 = -0.20` (correctly decreases score)

### Threshold Recalibration

Lowered `simpleMedium` from 0.16 → 0.08 so only clear trivia/greetings/definitions hit SIMPLE tier. Everything else escalates to MEDIUM (Sonnet).

### Reasoning Override

Now fires on **single strong keyword** (prove that, theorem, derive, formally, mathematical proof) rather than requiring 2+.

## Usage

```javascript
const { classifyRequest } = require('./router-modality.cjs');

const result = classifyRequest(prompt, event);

console.log(result.tier);       // 'SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING'
console.log(result.confidence); // 0.0 - 1.0
console.log(result.model);       // Selected model for tier
console.log(result.modelSource); // 'env', 'config', or 'default'
```

## Test

```bash
node test-standalone.js
node tune-thresholds.cjs
```

## Recent Changes

### v1.2.0 (2026-03-25)
- **Critical Fix**: Changed `before_model_resolve` hook from `api.registerHook()` to `api.on()`
  - `api.registerHook()` is for **internal lifecycle hooks only** — never fires during agent runs
  - `api.on()` is for **typed plugin hooks** — participates in agent model selection pipeline
  - Now routes correctly on every agent turn
- **Added**: `providerOverride` split for provider-prefixed model IDs (e.g., `amazon-bedrock/us.xxx`)
- **Added**: Verbose console logging for debugging hook fires and routing decisions
- **Docs**: Added OpenClaw plugin installation instructions

### v1.1.2 (2026-03-23)
- **Docs**: Added OpenAI config example (major gap)
- **Docs**: Added Model Name Formats table by provider
- **Docs**: Added Quick Start and Troubleshooting sections
- **Docs**: Added File Locations table
- **Docs**: Added Model Capability Notes table
- **Docs**: Clarified partial override behavior (per-tier resolution)

### v1.1.1 (2026-03-23)
- **Docs**: Elevated config.json to primary customization path
- **Docs**: Added concrete config examples for Bedrock/Haiku, Ollama Cloud, local
- **Docs**: Clarified config.json placement in extension directory
- **Docs**: Documented config priority order (env > config > source)

### v1.1.0 (2026-03-22)
- **Bedrock Adaptation**: Added TIERS_BEDROCK with AWS cross-region profiles
- **Bug Fix**: Fixed simpleIndicators double-negative (score now positive, weight negative)
- **Threshold**: Lowered simpleMedium from 0.16 → 0.08
- **Keywords**: Added code keywords (create a function, write a function, refactor, debug)
- **Keywords**: Added creative/summary keywords (summarize, summary of)
- **Reasoning**: Single strong keyword now triggers REASONING tier
- **Simplified**: Removed Ollama env vars (OLLAMA_CLOUD_ENABLED, FORCE_LOCAL/CLOUD)
- **Default**: Now uses TIERS_BEDROCK as baseline

## License

ISC