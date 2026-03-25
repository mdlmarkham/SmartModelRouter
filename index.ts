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

// Default tier model mappings (Bedrock)
const DEFAULT_TIERS = {
  SIMPLE: 'amazon-bedrock/us.amazon.nova-lite-v1:0',
  MEDIUM: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
  COMPLEX: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
  REASONING: 'amazon-bedrock/us.anthropic.claude-opus-4-6-v1',
  MULTIMODAL: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
  LONG_CONTEXT: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
  FALLBACK: 'amazon-bedrock/us.anthropic.claude-opus-4-6-v1',
};

const plugin: OpenClawPluginDefinition = {
  id: 'smart-router',
  name: 'Smart Router',
  description: 'Intelligent model routing based on complexity',
  version: '1.1.0',  // bumped for hook API fix

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

    console.error('[smart-router] Plugin loaded');
    console.error('[smart-router] API methods:', Object.keys(api || {}).join(', '));

    // CRITICAL FIX: Use api.on() for typed plugin hooks (before_model_resolve)
    // api.registerHook() is for INTERNAL lifecycle hooks only (void return, not called during agent runs)
    if (typeof api?.on === 'function') {
      api.on('before_model_resolve', async (event: any, ctx: any) => {
        console.error('[smart-router] ========== HOOK FIRED ==========');
        console.error('[smart-router] Event keys:', Object.keys(event || {}));
        console.error('[smart-router] Context agentId:', ctx?.agentId);

        if (!router?.classifyRequest) {
          console.error('[smart-router] Router not available - skipping');
          return {};
        }

        try {
          const prompt = event?.prompt || '';
          const requestedModel = event?.model || ctx?.model;

          console.error('[smart-router] Prompt length:', prompt?.length || 0);
          console.error('[smart-router] Requested model:', requestedModel);

          if (!prompt || !prompt.trim()) {
            console.error('[smart-router] No prompt to analyze - skipping');
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
              console.error('[smart-router] Session resolution error:', (e as Error).message);
              // Fall back to current tier if session tracking fails
            }
          }

          const tierConfig = DEFAULT_TIERS[resolvedTier as keyof typeof DEFAULT_TIERS];
          if (!tierConfig) {
            console.error('[smart-router] No config for tier:', resolvedTier);
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
            const routeMsg = `[smart-router] Route: tier=${resolvedTier} → ${providerOverride ? `${providerOverride}/` : ''}${modelOverride} ${sessionInfo}`;
            console.error(routeMsg);
          }

          return {
            modelOverride,
            providerOverride,
          };
        } catch (e) {
          console.error('[smart-router] before_model_resolve hook error:', (e as Error).message);
          return {};
        }
      });

      console.error('[smart-router] Hook registered: before_model_resolve via api.on()');

      // Register hook for capturing complexity after each turn (llm_output)
      // llm_output IS a valid internal lifecycle hook, so api.registerHook() is okay here
      if (typeof api.registerHook === 'function' && complexityTracker) {
        api.registerHook('llm_output', async (event: any, ctx: any) => {
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
              console.error(`[smart-router] Tracked complexity: ${complexityScore.tier} (score: ${complexityScore.score?.toFixed(2)})`);
            }

            return event; // Pass through unchanged
          } catch (e) {
            console.error('[smart-router] llm_output hook error:', (e as Error).message);
            return event;
          }
        }, { name: 'smart-router-track' });

        console.error('[smart-router] Hook registered: llm_output via api.registerHook()');
      }
    } else {
      console.error('[smart-router] ERROR: api.on() not available!');
      console.error('[smart-router] Available API methods:', Object.keys(api || {}).join(', '));
    }
  },
};

export default plugin;