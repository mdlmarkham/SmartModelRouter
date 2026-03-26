import type { OpenClawPluginDefinition, OpenClawPluginApi } from "openclaw/plugin-sdk";

// Load router module
let router: any = null;
try {
  router = require('./router-modality.cjs');
} catch (e) {
  // Router module not available - plugin will be no-op
}

// Load complexity tracker for session state management
let complexityTracker: any = null;
try {
  complexityTracker = require('./complexity-tracker.cjs');
} catch (e) {
  // Complexity tracker not available - session tracking disabled
}

// Default tier model mappings (Ollama Cloud)
const DEFAULT_TIERS = {
  SIMPLE: 'ollama/nemotron-3-nano:30b-cloud',
  MEDIUM: 'ollama/glm-4.7:cloud',
  COMPLEX: 'ollama/glm-5:cloud',
  REASONING: 'ollama/minimax-m2.7:cloud',
  MULTIMODAL: 'ollama/kimi-k2.5:cloud',
  LONG_CONTEXT: 'ollama/nemotron-3-super:cloud',
  FALLBACK: 'ollama/mistral-large-3:675b-cloud',
};


// Helper function to resolve provider and model from tier
function resolveTierProvider(tier) {
  const tierMap = {
    'SIMPLE': 'ollama/nemotron-3-nano:30b-cloud',
    'MEDIUM': 'ollama/glm-4.7:cloud',
    'COMPLEX': 'ollama/glm-5:cloud',
    'REASONING': 'ollama/minimax-m2.7:cloud',
    'MULTIMODAL': 'ollama/kimi-k2.5:cloud',
    'LONG_CONTEXT': 'ollama/nemotron-3-super:cloud',
    'FALLBACK': 'ollama/mistral-large-3:675b-cloud',
  };
  return tierMap[tier] || tierMap['FALLBACK'];
}



const plugin: OpenClawPluginDefinition = {
  id: 'smart-router',
  name: 'Smart Router',
  description: 'Intelligent model routing based on complexity',
  version: '1.2.0',  // cleanup: proper logging, fix llm_output hook

  configSchema: {
    jsonSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        logDecisions: { type: 'boolean', default: true },
      },
    },
  },

  register(api: OpenClawPluginApi, config?: unknown) {
    const cfg = (config as any) || {};
    const logDecisions = cfg.logDecisions !== false;
    const logger = api.logger;

    logger.info('[smart-router] Plugin loaded v1.2.0');

    // Use api.on() for all typed plugin hooks
    // api.registerHook() is for internal lifecycle hooks only (void return)
    if (typeof api?.on !== 'function') {
      logger.error('[smart-router] ERROR: api.on() not available - plugin cannot function');
      return;
    }

    // before_model_resolve: route based on prompt complexity
    api.on('before_model_resolve', async (event: any, ctx: any) => {
      if (!router?.classifyRequest) {
        return {};
      }

      try {
        const prompt = event?.prompt || '';
        const requestedModel = event?.model || ctx?.model;

        if (!prompt || !prompt.trim()) {
          return {};
        }

        // Classify current request
        const result = router.classifyRequest(prompt, event);
        let currentTier = result.tier || 'COMPLEX';

        // Resolve with session state if tracker is available
        let resolvedTier = currentTier;
        let sessionContext: any = null;

        if (complexityTracker && ctx?.sessionKey) {
          try {
            const resolved = await complexityTracker.resolveWithSession(
              ctx,
              api,
              result,
              { maxEscalations: 3 }
            );
            resolvedTier = resolved.tier;
            sessionContext = resolved.sessionContext;
          } catch (e) {
            // Fall back to current tier if session tracking fails
          }
        }

        const tierConfig = resolveTierProvider(resolvedTier);
        if (!tierConfig) {
          return {};
        }

        // Parse provider/model from the tier config
        // Format can be: 'modelId' or 'provider/modelId'
        let modelOverride: string;
        let providerOverride: string | undefined;

        if (tierConfig.includes('/')) {
          const slashIdx = tierConfig.indexOf('/');
          providerOverride = tierConfig.slice(0, slashIdx);
          modelOverride = tierConfig.slice(slashIdx + 1);
        } else {
          modelOverride = tierConfig;
        }

        if (logDecisions) {
          const sessionInfo = sessionContext?.isFirstTurn
            ? '(first turn)'
            : sessionContext?.isThrottled
              ? `(throttled at ${sessionContext.previousTier})`
              : sessionContext?.resolvedTier !== currentTier
                ? `(escalated from ${sessionContext?.previousTier})`
                : '';
          logger.info(`[smart-router] Route: tier=${resolvedTier} → ${providerOverride ? `${providerOverride}/` : ''}${modelOverride} ${sessionInfo}`);
        }

        return {
          modelOverride,
          providerOverride,
        };
      } catch (e) {
        logger.error('[smart-router] before_model_resolve hook error:', (e as Error).message);
        return {};
      }
    });

    // llm_output: track complexity patterns after each turn
    if (complexityTracker) {
      api.on('llm_output', async (event: any, ctx: any) => {
        try {
          const response = event?.response || event?.output || event?.text || '';
          if (!response || typeof response !== 'string' || !response.trim()) {
            return event;
          }

          if (!ctx?.sessionKey) {
            return event;
          }

          // Classify the output to track complexity patterns
          const complexityScore = router.classifyRequest(response, event);

          // Update session state with the complexity
          await complexityTracker.updateAfterTurn(ctx, api, complexityScore);

          if (logDecisions) {
            logger.info(`[smart-router] Tracked complexity: ${complexityScore.tier} (score: ${complexityScore.score?.toFixed(2)})`);
          }

          return event;
        } catch (e) {
          logger.error('[smart-router] llm_output hook error:', (e as Error).message);
          return event;
        }
      });
    }

    logger.info('[smart-router] Hooks registered: before_model_resolve, llm_output');
  },
};

export default plugin;