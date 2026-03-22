import type { OpenClawPluginDefinition, OpenClawPluginApi } from "openclaw/plugin-sdk";

// Load router module
let router: any = null;
try {
  router = require('./router-modality.cjs');
} catch (e) {
  console.error('[smart-router] Failed to load router module:', (e as Error).message);
}

// Load complexity tracker for session state management
let complexityTracker: any = null;
try {
  complexityTracker = require('./complexity-tracker.cjs');
} catch (e) {
  console.error('[smart-router] Failed to load complexity tracker:', (e as Error).message);
}

const DEFAULT_TIERS = {
  SIMPLE: 'nemotron-3-nano:30b-cloud',
  MEDIUM: 'glm-4.7:cloud',
  COMPLEX: 'glm-5:cloud',
  REASONING: 'minimax-m2.7:cloud',
  MULTIMODAL: 'kimi-k2.5:cloud',
  LONG_CONTEXT: 'nemotron-3-super:cloud',
  FALLBACK: 'mistral-large-3:675b-cloud',
};

const plugin: OpenClawPluginDefinition = {
  id: 'smart-router',
  name: 'Smart Router',
  description: 'Intelligent model routing based on complexity',
  version: '1.0.0',

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

    console.log('[smart-router] Plugin loaded');

    // Register hook for model resolution (before model selection)
    if (typeof api.registerHook === 'function') {
      try {
        api.registerHook('before_model_resolve', async (event: any, ctx: any) => {
          if (!router?.classifyRequest) {
            return {};
          }
          
          try {
            const prompt = event?.prompt || '';
            if (!prompt || !prompt.trim()) {
              return {};
            }

            // Classify current request
            const result = router.classifyRequest(prompt, event);
            const currentTier = result.tier || 'COMPLEX';
            
            // Resolve with session state if tracker is available
            let resolvedTier = currentTier;
            let sessionContext: any = null;
            
            if (complexityTracker && ctx?.sessionKey) {
              const resolved = await complexityTracker.resolveWithSession(
                ctx,
                api,
                result,
                { maxEscalations: 3 }
              );
              resolvedTier = resolved.tier;
              sessionContext = resolved.sessionContext;
            }
            
            const model = DEFAULT_TIERS[resolvedTier as keyof typeof DEFAULT_TIERS] || DEFAULT_TIERS.COMPLEX;

            if (logDecisions) {
              const sessionInfo = sessionContext?.isFirstTurn 
                ? '(first turn)' 
                : sessionContext?.isThrottled 
                  ? `(throttled at ${sessionContext.previousTier})`
                  : sessionContext?.resolvedTier !== currentTier
                    ? `(escalated from ${sessionContext?.previousTier})`
                    : '';
              console.log(`[smart-router] ${resolvedTier} → ${model} ${sessionInfo}`);
            }

            return { modelOverride: model };
          } catch (e) {
            console.error('[smart-router] before_model_resolve hook error:', (e as Error).message);
            return {};
          }
        }, { name: 'smart-router-resolve' });

        console.log('[smart-router] Hook registered: before_model_resolve');
      } catch (e) {
        console.error('[smart-router] Failed to register before_model_resolve hook:', (e as Error).message);
      }
      
      // Register hook for capturing complexity after each turn (llm_output)
      try {
        api.registerHook('llm_output', async (event: any, ctx: any) => {
          if (!router?.classifyRequest || !complexityTracker) {
            return event; // Pass through unchanged
          }
          
          try {
            // Extract the response text for classification
            const response = event?.response || event?.output || event?.text || '';
            if (!response || typeof response !== 'string' || !response.trim()) {
              return event; // Pass through unchanged
            }
            
            // Only track if we have a session key
            if (!ctx?.sessionKey) {
              return event;
            }
            
            // Classify the output to track complexity patterns
            const complexityScore = router.classifyRequest(response, event);
            
            // Update session state with the complexity
            await complexityTracker.updateAfterTurn(ctx, api, complexityScore);
            
            if (logDecisions) {
              console.log(`[smart-router] Tracked complexity: ${complexityScore.tier} (score: ${complexityScore.score?.toFixed(2)})`);
            }
            
            return event; // Pass through unchanged
          } catch (e) {
            console.error('[smart-router] llm_output hook error:', (e as Error).message);
            return event; // Pass through unchanged
          }
        }, { name: 'smart-router-track' });

        console.log('[smart-router] Hook registered: llm_output');
      } catch (e) {
        console.error('[smart-router] Failed to register llm_output hook:', (e as Error).message);
      }
    } else {
      console.log('[smart-router] Warning: registerHook not available');
    }
  },
};

export default plugin;