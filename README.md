# SmartModelRouter

Intelligent model routing for OpenClaw, AWS Bedrock, and similar LLM gateways. Uses 14-dimension complexity scoring to automatically select the optimal model for each request.

## Features

- **14-Dimension Complexity Scoring** — Analyzes prompts across multiple complexity axes
- **Dynamic Tier Routing** — Automatically routes to SIMPLE, MEDIUM, COMPLEX, or REASONING models
- **Modality Detection** — Detects vision/image requests for MULTIMODAL routing
- **Long Context Detection** — Identifies requests needing large context windows
- **Dynamic Escalation** — Escalates complexity tier mid-conversation (never downgrades)
- **Model Optimization** — Routes simpler requests to cheaper models (10-20x cost savings)
- **Session-Aware** — Tracks conversation complexity across turns
- **AWS Bedrock Support** — Native support for cross-region inference profiles

## Accuracy

- **79% accuracy** on calibrated test set
- **100% accuracy** on MULTIMODAL and LONG_CONTEXT detection
- **100% accuracy** on REASONING tier (reasoning-override triggers)
- **12/14 tests passing** (MEDIUM vs COMPLEX both route to same Sonnet model)

## Tier Boundaries

| Tier | Score Range | Typical Use Case |
|------|-------------|------------------|
| SIMPLE | < 0.08 | Trivia, greetings, definitions |
| MEDIUM | 0.08 - 0.32 | Explanations, summaries |
| COMPLEX | 0.32 - 0.58 | Implementations, architecture |
| REASONING | ≥ 0.58 | Proofs, formal logic |

## Default Model Mappings

### AWS Bedrock (Default)

| Tier | Model |
|------|-------|
| SIMPLE | amazon-bedrock/us.amazon.nova-lite-v1:0 |
| MEDIUM | amazon-bedrock/us.anthropic.claude-sonnet-4-6 |
| COMPLEX | amazon-bedrock/us.anthropic.claude-sonnet-4-6 |
| REASONING | amazon-bedrock/us.anthropic.claude-opus-4-6-v1 |
| MULTIMODAL | amazon-bedrock/us.anthropic.claude-sonnet-4-6 |
| LONG_CONTEXT | amazon-bedrock/us.anthropic.claude-sonnet-4-6 |
| FALLBACK | amazon-bedrock/us.anthropic.claude-opus-4-6-v1 |

### Ollama Cloud (Alternative)

| Tier | Model |
|------|-------|
| SIMPLE | nemotron-3-nano:30b-cloud |
| MEDIUM | glm-4.7:cloud |
| COMPLEX | glm-5:cloud |
| REASONING | minimax-m2.7:cloud |
| MULTIMODAL | kimi-k2.5:cloud |
| LONG_CONTEXT | nemotron-3-super:cloud |

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

## Installation

```bash
npm install @openclaw/smart-router
```

Or copy the files to your OpenClaw extensions directory:
```bash
cp -r ./* /path/to/openclaw/extensions/smart-router/
```

## Configuration

Add to your OpenClaw config:

```json
{
  "models": {
    "routing": {
      "enabled": true,
      "tiers": {
        "SIMPLE": "your-cheap-model",
        "MEDIUM": "your-mid-model",
        "COMPLEX": "your-capable-model",
        "REASONING": "your-reasoning-model",
        "MULTIMODAL": "your-vision-model",
        "LONG_CONTEXT": "your-large-context-model",
        "FALLBACK": "your-fallback-model"
      },
      "thresholds": {
        "simpleMedium": 0.08,
        "mediumComplex": 0.32,
        "complexReasoning": 0.58
      }
    }
  }
}
```

### Environment Overrides

```bash
# Per-tier model overrides
SMART_ROUTER_SIMPLE_MODEL=your-cheap-model
SMART_ROUTER_MEDIUM_MODEL=your-mid-model
SMART_ROUTER_COMPLEX_MODEL=your-capable-model
SMART_ROUTER_REASONING_MODEL=your-reasoning-model
```

## Usage

```javascript
const { classifyRequest } = require('./router-modality.cjs');

const result = classifyRequest(prompt, event);

console.log(result.tier);      // 'SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING'
console.log(result.confidence); // 0.0 - 1.0
console.log(result.model);      // Selected model for tier
console.log(result.modelSource); // 'env', 'config', or 'default'
```

## Test

```bash
node test-standalone.js
node tune-thresholds.cjs
```

## Recent Changes

### v1.1.0 (2026-03-22)
- **Bedrock Adaptation**: Added TIERS_BEDROCK with AWS cross-region inference profiles
- **Bug Fix**: Fixed simpleIndicators double-negative (score now positive, weight negative)
- **Threshold**: Lowered simpleMedium from 0.16 → 0.08
- **Keywords**: Added code keywords (create a function, write a function, refactor, debug)
- **Keywords**: Added creative/summary keywords (summarize, summary of, explain in detail)
- **Reasoning**: Single strong keyword now triggers REASONING tier
- **Simplified**: Removed Ollama env vars (OLLAMA_CLOUD_ENABLED, FORCE_LOCAL, FORCE_CLOUD)
- **Default**: Now uses TIERS_BEDROCK as baseline

## License

ISC