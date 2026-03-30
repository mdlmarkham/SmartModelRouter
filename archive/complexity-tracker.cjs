/**
 * Complexity Tracker - Session State Management
 * 
 * Tracks complexity scores across turns to enable dynamic escalation.
 * Stores state in ACP session metadata so it persists across requests.
 */

// Tier ordering for escalation logic (never downgrade mid-thread)
const TIER_ORDER = ['SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING', 'MULTIMODAL', 'LONG_CONTEXT'];

/**
 * Get the higher of two tiers
 * @param {string} a - First tier
 * @param {string} b - Second tier
 * @returns {string} - The higher tier
 */
function maxTier(a, b) {
  const aIndex = TIER_ORDER.indexOf(a);
  const bIndex = TIER_ORDER.indexOf(b);
  
  // Handle unknown tiers - treat as COMPLEX
  const complexIndex = TIER_ORDER.indexOf('COMPLEX');
  const aValid = aIndex >= 0 ? aIndex : complexIndex;
  const bValid = bIndex >= 0 ? bIndex : complexIndex;
  
  // Return the higher tier, but use COMPLEX as fallback for unknowns
  if (bValid > aValid) {
    return bIndex >= 0 ? b : 'COMPLEX';
  }
  return aIndex >= 0 ? a : 'COMPLEX';
}

/**
 * Check if escalation should be throttled
 * @param {object} sessionState - Current session state
 * @param {number} maxEscalations - Maximum escalations per session (default 3)
 * @returns {boolean} - True if throttled
 */
function isThrottled(sessionState, maxEscalations = 3) {
  return (sessionState?.escalationCount || 0) >= maxEscalations;
}

/**
 * Read session state from ACP metadata
 * @param {object} ctx - Plugin context with sessionKey
 * @param {object} api - OpenClaw API for metadata access
 * @returns {Promise<object|null>} - Session state or null
 */
async function readSessionState(ctx, api) {
  if (!ctx?.sessionKey) {
    return null;
  }

  try {
    // Check if API has session metadata methods
    if (typeof api.getSessionMeta === 'function') {
      const meta = await api.getSessionMeta(ctx.sessionKey);
      return meta?.smartRouter || null;
    }
    
    // Fallback: check if there's a direct method
    if (typeof api.acp?.getSessionMeta === 'function') {
      const meta = await api.acp.getSessionMeta(ctx.sessionKey);
      return meta?.smartRouter || null;
    }

    return null;
  } catch (e) {
    console.error('[complexity-tracker] Failed to read session state:', e.message);
    return null;
  }
}

/**
 * Write session state to ACP metadata
 * @param {object} ctx - Plugin context with sessionKey
 * @param {object} api - OpenClaw API for metadata access
 * @param {object} state - State to write
 * @returns {Promise<boolean>} - Success status
 */
async function writeSessionState(ctx, api, state) {
  if (!ctx?.sessionKey) {
    return false;
  }

  try {
    // Check if API has session metadata methods
    if (typeof api.setSessionMeta === 'function') {
      await api.setSessionMeta(ctx.sessionKey, 'smartRouter', state);
      return true;
    }
    
    // Fallback: check if there's a direct method
    if (typeof api.acp?.setSessionMeta === 'function') {
      await api.acp.setSessionMeta(ctx.sessionKey, 'smartRouter', state);
      return true;
    }

    console.warn('[complexity-tracker] No session metadata API available');
    return false;
  } catch (e) {
    console.error('[complexity-tracker] Failed to write session state:', e.message);
    return false;
  }
}

/**
 * Update session state after each turn
 * @param {object} ctx - Plugin context
 * @param {object} api - OpenClaw API
 * @param {object} classificationResult - Result from classifyRequest
 * @returns {Promise<object>} - Updated session state
 */
async function updateAfterTurn(ctx, api, classificationResult) {
  const previousState = await readSessionState(ctx, api) || {};
  
  const now = Date.now();
  const currentTier = classificationResult?.tier || 'COMPLEX';
  const previousTier = previousState.lastComplexity?.tier || 'SIMPLE';
  
  // Track escalation history
  const escalationHistory = previousState.escalationHistory || [];
  if (currentTier !== previousTier && previousState.lastComplexity) {
    escalationHistory.push({
      from: previousTier,
      to: currentTier,
      timestamp: now,
      score: classificationResult?.score,
    });
  }
  
  // Calculate escalation count
  let escalationCount = previousState.escalationCount || 0;
  if (currentTier !== previousTier && previousState.lastComplexity) {
    escalationCount++;
  }
  
  const newState = {
    lastComplexity: {
      tier: currentTier,
      score: classificationResult?.score || 0,
      confidence: classificationResult?.confidence || 0,
      timestamp: now,
    },
    escalationCount,
    escalationHistory: escalationHistory.slice(-10), // Keep last 10 escalations
    sessionKey: ctx.sessionKey,
  };
  
  await writeSessionState(ctx, api, newState);
  
  return newState;
}

/**
 * Resolve tier considering session history
 * Never downgrade mid-thread, obey throttling
 * @param {object} ctx - Plugin context
 * @param {object} api - OpenClaw API
 * @param {object} currentResult - Current classification result
 * @param {object} options - Options for throttling etc.
 * @returns {Promise<object>} - Resolved classification with session context
 */
async function resolveWithSession(ctx, api, currentResult, options = {}) {
  const maxEscalations = options.maxEscalations ?? 3;
  const previousState = await readSessionState(ctx, api);
  
  if (!previousState) {
    // No previous state - use current classification
    return {
      ...currentResult,
      sessionContext: {
        isFirstTurn: true,
        resolvedTier: currentResult.tier,
        previousTier: null,
      },
    };
  }
  
  const previousTier = previousState.lastComplexity?.tier || 'SIMPLE';
  const currentTier = currentResult.tier || 'COMPLEX';
  
  // Check throttling
  if (isThrottled(previousState, maxEscalations)) {
    console.log(`[complexity-tracker] Throttled at ${previousTier} (${previousState.escalationCount} escalations)`);
    return {
      ...currentResult,
      tier: previousTier,
      model: getModelForTier(previousTier),
      sessionContext: {
        isThrottled: true,
        resolvedTier: previousTier,
        previousTier,
        escalationCount: previousState.escalationCount,
      },
    };
  }
  
  // Resolve tier: escalate but never downgrade
  const resolvedTier = maxTier(previousTier, currentTier);
  
  if (resolvedTier !== currentTier) {
    console.log(`[complexity-tracker] Escalated: ${previousTier} → ${resolvedTier}`);
  }
  
  return {
    ...currentResult,
    tier: resolvedTier,
    model: getModelForTier(resolvedTier),
    sessionContext: {
      isFirstTurn: false,
      resolvedTier,
      previousTier,
      escalationCount: previousState.escalationCount,
    },
  };
}

/**
 * Get model for a tier
 * @param {string} tier - Tier name
 * @returns {string} - Model name
 */
function getModelForTier(tier) {
  const tierModels = {
    SIMPLE: 'nemotron-3-nano:30b-cloud',
    MEDIUM: 'glm-4.7:cloud',
    COMPLEX: 'glm-5:cloud',
    REASONING: 'minimax-m2.7:cloud',
    MULTIMODAL: 'kimi-k2.5:cloud',
    LONG_CONTEXT: 'nemotron-3-super:cloud',
    FALLBACK: 'mistral-large-3:675b-cloud',
  };
  
  return tierModels[tier] || tierModels.COMPLEX;
}

/**
 * Clear session state (for testing/reset)
 * @param {object} ctx - Plugin context
 * @param {object} api - OpenClaw API
 * @returns {Promise<boolean>}
 */
async function clearSessionState(ctx, api) {
  return writeSessionState(ctx, api, null);
}

/**
 * Get escalation statistics for a session
 * @param {object} ctx - Plugin context
 * @param {object} api - OpenClaw API
 * @returns {Promise<object>} - Stats object
 */
async function getEscalationStats(ctx, api) {
  const state = await readSessionState(ctx, api);
  
  if (!state) {
    return {
      hasSession: false,
      escalationCount: 0,
      currentTier: null,
      history: [],
    };
  }
  
  return {
    hasSession: true,
    escalationCount: state.escalationCount || 0,
    currentTier: state.lastComplexity?.tier || 'SIMPLE',
    lastScore: state.lastComplexity?.score || 0,
    history: state.escalationHistory || [],
    lastUpdate: state.lastComplexity?.timestamp || null,
  };
}

module.exports = {
  TIER_ORDER,
  maxTier,
  isThrottled,
  readSessionState,
  writeSessionState,
  updateAfterTurn,
  resolveWithSession,
  getModelForTier,
  clearSessionState,
  getEscalationStats,
};