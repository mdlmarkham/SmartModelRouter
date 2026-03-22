# SmartModelRouter

Intelligent model routing for OpenClaw and similar LLM gateways. Uses 14-dimension complexity scoring to automatically select the optimal model for each request.

## Features

- **14-Dimension Complexity Scoring** — Analyzes prompts across multiple complexity axes
- **Dynamic Tier Routing** — Automatically routes to SIMPLE, MEDIUM, COMPLEX, or REASONING models
- **Modality Detection** — Detects vision/image requests for MULTIMODAL routing
- **Long Context Detection** — Identifies requests needing large context windows
- **Dynamic Escalation** — Escalates complexity tier mid-conversation (never downgrades)
- **Model Optimization** — Routes simpler requests to cheaper models (10-20x cost savings)
- **Session-Aware** — Tracks conversation complexity across turns

## Accuracy

- **79% accuracy** on calibrated test set
- **100% accuracy** on MULTIMODAL and LONG_CONTEXT detection
- **100% accuracy** on REASONING tier (reasoning-override triggers)

## Tier Boundaries

| Tier | Score Range | Typical Use Case |
|------|-------------|------------------|
| SIMPLE | < 0.16 | Simple queries, definitions |
| MEDIUM | 0.16 - 0.32 | Explanations, summaries |
| COMPLEX | 0.32 - 0.58 | Implementations, architecture |
| REASONING | ≥ 0.58 | Proofs, formal logic |

## Complexity Dimensions

1. **tokenCount** — Request length
2. **codePresence** — Code keywords (function, class, implement)
3. **reasoningMarkers** — Reasoning keywords (prove, theorem, derive)
4. **technicalTerms** — Technical vocabulary
5. **creativeMarkers** — Creative requests (story, poem)
6. **simpleIndicators** — Simple queries (what is, define)
7. **multiStepPatterns** — Multi-step tasks (first...then)
8. **questionComplexity** — Question depth
9. **imperativeVerbs** — Action verbs (build, create)
10. **constraintCount** — Constraints (must be, without)
11. **outputFormat** — Format requirements (JSON, table)
12. **referenceComplexity** — Citations, URLs
13. **negationComplexity** — Negations (not, never)
14. **agenticTask** — Tool usage requests

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
        "simpleMedium": 0.16,
        "mediumComplex": 0.32,
        "complexReasoning": 0.58
      }
    }
  }
}
```

## Usage

```javascript
const { classifyRequest } = require('./router-modality.cjs');

const result = classifyRequest(prompt, event);

console.log(result.tier);      // 'SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING'
console.log(result.confidence); // 0.0 - 1.0
console.log(result.model);      // Selected model for tier
```

## Test

```bash
node test-standalone.js
node tune-thresholds.cjs
```

## License

MIT

## Credits

Inspired by ClawRouter's 14-dimension scoring approach. This implementation is MIT-licensed and designed for integration with OpenClaw.