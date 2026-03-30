# SmartModelRouter

Intelligent model routing for OpenClaw based on prompt complexity.

## What It Does

Routes prompts to appropriate models based on:
1. **Content complexity** — 14-dimension scoring (code presence, reasoning markers, technical terms, etc.)
2. **Modality detection** — Vision content → multimodal models
3. **Context length** — "Entire codebase" → long context models
4. **Reasoning signals** — Mathematical/proof → reasoning models

## Tiers

| Tier | Model | Use Case |
|------|-------|-----------|
| SIMPLE | glm-4.7:cloud | Quick Q&A, definitions, short answers |
| MEDIUM | glm-4.7:cloud | Explanations, summaries, simple code |
| COMPLEX | glm-5:cloud | Implementation, architecture, multi-step |
| REASONING | minimax-m2.7:cloud | Proofs, formal logic, deep reasoning |
| MULTIMODAL | kimi-k2.5:cloud | Images, screenshots, UI, diagrams |
| LONG_CONTEXT | nemotron-3-super:cloud | Long documents, codebases, books |

## Installation

```bash
# Clone to your OpenClaw extensions directory
cd ~/.openclaw/extensions
git clone https://github.com/mdlmarkham/SmartModelRouter.git smart-router

# Enable in openclaw.json
```

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["smart-router"],
    "entries": {
      "smart-router": { "enabled": true }
    },
    "load": {
      "paths": ["~/.openclaw/extensions/smart-router"]
    }
  }
}
```

## Configuration

Create `config.json` in the plugin directory:

```json
{
  "enabled": true,
  "logDecisions": true,
  "models": {
    "SIMPLE": "ollama/glm-4.7:cloud",
    "MEDIUM": "ollama/glm-4.7:cloud",
    "COMPLEX": "ollama/glm-5:cloud",
    "REASONING": "ollama/minimax-m2.7:cloud",
    "MULTIMODAL": "ollama/kimi-k2.5:cloud",
    "LONG_CONTEXT": "ollama/nemotron-3-super:cloud",
    "FALLBACK": "ollama/glm-5:cloud"
  }
}
```

Override any tier with a different model. Use `provider/model` format for non-default providers.

## How It Works

### Hook Integration

Uses OpenClaw's `before_model_resolve` hook to intercept model selection:

```javascript
api.on('before_model_resolve', async (event, ctx) => {
  // Classify prompt
  const result = classifyPrompt(event.prompt, event);
  
  // Return model override
  return {
    modelOverride: 'glm-5:cloud',
    providerOverride: 'ollama'
  };
});
```

### Classification Flow

1. **Modality check** — If vision content detected → MULTIMODAL
2. **Long context check** — If "entire codebase" or >50K tokens → LONG_CONTEXT
3. **Reasoning check** — If theorem/proof keywords → REASONING
4. **Complexity scoring** — Weighted sum of 14 dimensions
5. **Tier mapping** — Score → tier based on boundaries

### Complexity Dimensions

| Dimension | Weight | Keywords |
|-----------|--------|----------|
| codePresence | 0.12 | function, class, async, import, API |
| reasoningMarkers | 0.15 | prove, derive, step-by-step, logic |
| technicalTerms | 0.10 | algorithm, architecture, kubernetes |
| creativeMarkers | 0.05 | story, poem, brainstorm |
| simpleIndicators | 0.08 | what is, define, briefly |
| imperativeVerbs | 0.07 | build, create, implement |
| constraintCount | 0.06 | must be, without, exactly |
| outputFormat | 0.05 | json, markdown, table |
| domainSpecificity | 0.06 | legal, medical, financial |
| tokenCount | 0.08 | -0.5 for <500, +0.5 for >5000 |

### Tier Boundaries (Tuned)

```
SIMPLE:  score < -0.15
MEDIUM:  -0.15 ≤ score < 0.0
COMPLEX: 0.0 ≤ score < 0.25
REASONING: score ≥ 0.25
```

## Testing

```bash
node test-plugin.js
```

Expected output:
```
[smart-router] Complexity score -0.06 → MEDIUM | signals: [...] → glm-4.7:cloud
[smart-router] Complexity score 0.05 → COMPLEX | signals: [...] → glm-5:cloud
[smart-router] Reasoning keywords detected → REASONING | signals: [...] → minimax-m2.7:cloud
[smart-router] Vision content detected → MULTIMODAL | signals: [...] → kimi-k2.5:cloud
[smart-router] Long context required → LONG_CONTEXT | signals: [...] → nemotron-3-super:cloud
```

## Version History

### v4.0.0 (2026-03-30)
- Complete rewrite for OpenClaw 2026.3.x
- Uses `api.on('before_model_resolve')` for proper hook integration
- Stateless classification (removed session tracking)
- Tuned tier boundaries from testing
- Simplified architecture: single `index.js` file

### v3.x (Archived)
- Previous versions using `api.registerHook()` (deprecated)
- Session state tracking (removed for simplicity)
- Multiple CJS modules (archived)

## License

MIT