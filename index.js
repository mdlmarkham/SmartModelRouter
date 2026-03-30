/**
 * SmartModelRouter - Intelligent Model Routing for OpenClaw
 * 
 * Routes prompts to appropriate models based on:
 * 1. Content complexity (14-dimension scoring)
 * 2. Modality detection (text vs vision)
 * 3. Context length requirements
 * 4. Model capabilities
 * 
 * Key design principles:
 * - Fail-safe: Always return a valid model, never break the agent
 * - Transparent: Log routing decisions for debugging
 * - Configurable: Override tiers via config or env vars
 * 
 * Version 4.0.0 - Clean rewrite for OpenClaw 2026.3.x
 * - Uses api.on('before_model_resolve') for proper hook integration
 * - Stateless classification (no session tracking)
 * - Tuned tier boundaries from testing
 */

'use strict';

const fs = require('fs');
const path = require('path');

// === Configuration Loading ===

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('[smart-router] Failed to load config.json:', err.message);
  }
  return { enabled: true, logDecisions: true, models: {} };
}

// === Tier Assignments ===

const DEFAULT_TIERS = {
  SIMPLE: {
    model: 'glm-4.7:cloud',
    contextWindow: 131072,
    reasoning: false,
    modality: ['text'],
    useCase: 'Quick Q&A, definitions, short answers',
  },
  MEDIUM: {
    model: 'glm-4.7:cloud',
    contextWindow: 131072,
    reasoning: false,
    modality: ['text'],
    useCase: 'Explanations, summaries, simple code',
  },
  COMPLEX: {
    model: 'glm-5:cloud',
    contextWindow: 131072,
    reasoning: true,
    modality: ['text'],
    useCase: 'Implementation, architecture, multi-step',
  },
  REASONING: {
    model: 'minimax-m2.7:cloud',
    contextWindow: 204800,
    reasoning: true,
    modality: ['text'],
    useCase: 'Proofs, formal logic, deep reasoning',
  },
  MULTIMODAL: {
    model: 'kimi-k2.5:cloud',
    contextWindow: 262144,
    reasoning: true,
    modality: ['text', 'vision'],
    useCase: 'Images, screenshots, UI, diagrams',
  },
  LONG_CONTEXT: {
    model: 'nemotron-3-super:cloud',
    contextWindow: 524288,
    reasoning: true,
    modality: ['text'],
    useCase: 'Long documents, codebases, books',
  },
  FALLBACK: {
    model: 'glm-5:cloud',
    contextWindow: 131072,
    reasoning: true,
    modality: ['text'],
    useCase: 'Fallback, reliable model',
  },
};

// Tier boundaries for complexity scoring (tuned from testing)
const TIER_BOUNDARIES = {
  simpleMedium: -0.15,   // Below -0.15 = SIMPLE
  mediumComplex: 0.0,    // -0.15 to 0.0 = MEDIUM, 0.0 to 0.25 = COMPLEX
  complexReasoning: 0.25, // Above 0.25 = REASONING
};

// Weights for complexity dimensions
const WEIGHTS = {
  tokenCount: 0.08,
  codePresence: 0.12,
  reasoningMarkers: 0.15,
  technicalTerms: 0.10,
  creativeMarkers: 0.05,
  simpleIndicators: 0.08,
  multiStepPatterns: 0.10,
  questionComplexity: 0.08,
  imperativeVerbs: 0.07,
  constraintCount: 0.06,
  outputFormat: 0.05,
  domainSpecificity: 0.06,
};

// Keyword lists for complexity detection
const KEYWORDS = {
  code: ['function', 'class', 'method', 'variable', 'const', 'let', 'var', 'async', 'await', 'import', 'export', 'return', 'if', 'else', 'for', 'while', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'API', 'interface', 'type', 'implement'],
  reasoning: ['prove', 'theorem', 'derive', 'step-by-step', 'systematic', 'analyze', 'reason', 'logic', 'infer', 'deduce', 'therefore', 'conclusion', 'premise', 'argument', 'proof', 'formal'],
  technical: ['algorithm', 'architecture', 'component', 'module', 'service', 'endpoint', 'request', 'response', 'database', 'kubernetes', 'docker', 'container', 'microservice', 'distributed', 'concurrent', 'parallel', 'synchronous', 'asynchronous'],
  creative: ['story', 'poem', 'creative', 'brainstorm', 'imagine', 'invent', 'fiction', 'narrative', 'character', 'plot', 'scene'],
  simple: ['what is', 'define', 'translate', 'how to', 'explain', 'simple', 'basic', 'briefly', 'quickly'],
  imperative: ['build', 'create', 'implement', 'write', 'develop', 'design', 'construct', 'generate', 'produce', 'make', 'fix', 'solve', 'debug'],
  constraints: ['must be', 'without', 'only use', 'exactly', 'specifically', 'requirements', 'constraint', 'limitation', 'strictly', 'mandatory'],
  outputFormat: ['json', 'markdown', 'table', 'list', 'format', 'structured', 'output', 'result'],
  domain: ['legal', 'medical', 'financial', 'scientific', 'engineering', 'academic', 'research', 'professional'],
  vision: ['image', 'screenshot', 'diagram', 'chart', 'graph', 'photo', 'picture', 'visual', 'ui', 'ux', 'interface', 'design'],
  longContext: ['entire codebase', 'all files', 'complete repository', 'whole project', 'full log', 'entire document'],
};

// === Classification Functions ===

function scoreKeywordMatch(text, keywords, thresholds, scores) {
  const matches = keywords.filter(kw => text.includes(kw.toLowerCase()));
  const count = matches.length;
  
  if (count === 0) return scores.none;
  if (count < thresholds.low) return scores.low;
  return scores.high;
}

function estimateTokenCount(text) {
  return Math.ceil(text.length / 4);
}

function detectModality(event) {
  const modalities = ['text'];
  
  if (event?.messages) {
    for (const msg of event.messages) {
      if (msg.images?.length > 0 || msg.image?.url || msg.image?.base64) {
        if (!modalities.includes('vision')) modalities.push('vision');
      }
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image' || part.type === 'image_url' || part.image_url) {
            if (!modalities.includes('vision')) modalities.push('vision');
          }
        }
      }
    }
  }
  
  const prompt = event?.prompt || '';
  if (/\bdata:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(prompt)) {
    if (!modalities.includes('vision')) modalities.push('vision');
  }
  
  return modalities;
}

function needsLongContext(prompt, estimatedTokens) {
  const lower = prompt.toLowerCase();
  if (lower.includes('entire codebase') ||
      lower.includes('all files in') ||
      lower.includes('complete repository') ||
      lower.includes('whole project')) {
    return true;
  }
  if (estimatedTokens > 50000) {
    return true;
  }
  return false;
}

function classifyPrompt(prompt, event) {
  const userText = prompt.toLowerCase();
  const systemPrompt = event?.systemPrompt || '';
  const combinedText = userText + ' ' + systemPrompt.toLowerCase();
  
  // Step 1: Modality check
  const modalities = detectModality(event);
  if (modalities.includes('vision')) {
    return {
      tier: 'MULTIMODAL',
      score: 0.5,
      signals: ['vision-detected'],
      reason: 'Vision content detected → MULTIMODAL',
    };
  }
  
  // Step 2: Long context check
  const estimatedTokens = estimateTokenCount(prompt + systemPrompt);
  if (needsLongContext(prompt, estimatedTokens)) {
    return {
      tier: 'LONG_CONTEXT',
      score: 0.4,
      signals: [`tokens:${estimatedTokens}`],
      reason: 'Long context required → LONG_CONTEXT',
    };
  }
  
  // Step 3: Reasoning check
  const reasoningKeywords = KEYWORDS.reasoning.filter(kw => combinedText.includes(kw.toLowerCase()));
  const strongReasoning = ['prove that', 'theorem', 'derive', 'formal proof', 'mathematical'];
  const hasStrongReasoning = strongReasoning.some(kw => combinedText.includes(kw));
  
  if (hasStrongReasoning || reasoningKeywords.length >= 3) {
    return {
      tier: 'REASONING',
      score: 0.85,
      signals: [`reasoning:${reasoningKeywords.length}`, hasStrongReasoning ? 'strong-reasoning' : 'keyword-count'],
      reason: 'Reasoning keywords detected → REASONING',
    };
  }
  
  // Step 4: Complexity scoring
  const dimensions = [
    { name: 'tokenCount', score: estimatedTokens < 500 ? -0.5 : estimatedTokens > 5000 ? 0.5 : 0 },
    { name: 'codePresence', score: scoreKeywordMatch(combinedText, KEYWORDS.code, { low: 2, high: 4 }, { none: 0, low: 0.5, high: 1.0 }) },
    { name: 'reasoningMarkers', score: scoreKeywordMatch(combinedText, KEYWORDS.reasoning, { low: 1, high: 2 }, { none: 0, low: 0.7, high: 1.0 }) },
    { name: 'technicalTerms', score: scoreKeywordMatch(combinedText, KEYWORDS.technical, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 1.0 }) },
    { name: 'creativeMarkers', score: scoreKeywordMatch(combinedText, KEYWORDS.creative, { low: 1, high: 2 }, { none: 0, low: 0.3, high: 0.5 }) },
    { name: 'simpleIndicators', score: scoreKeywordMatch(combinedText, KEYWORDS.simple, { low: 1, high: 2 }, { none: 0, low: -0.5, high: -0.3 }) },
    { name: 'imperativeVerbs', score: scoreKeywordMatch(combinedText, KEYWORDS.imperative, { low: 2, high: 4 }, { none: 0, low: 0.4, high: 0.7 }) },
    { name: 'constraintCount', score: scoreKeywordMatch(combinedText, KEYWORDS.constraints, { low: 1, high: 2 }, { none: 0, low: 0.3, high: 0.6 }) },
    { name: 'outputFormat', score: scoreKeywordMatch(combinedText, KEYWORDS.outputFormat, { low: 1, high: 2 }, { none: 0, low: 0.3, high: 0.5 }) },
    { name: 'domainSpecificity', score: scoreKeywordMatch(combinedText, KEYWORDS.domain, { low: 1, high: 2 }, { none: 0, low: 0.4, high: 0.7 }) },
  ];
  
  // Calculate weighted score
  let weightedScore = 0;
  const signals = [];
  
  for (const dim of dimensions) {
    const weight = WEIGHTS[dim.name] ?? 0.05;
    weightedScore += dim.score * weight;
    if (Math.abs(dim.score) > 0.2) {
      signals.push(`${dim.name}:${dim.score > 0 ? '+' : ''}${dim.score.toFixed(2)}`);
    }
  }
  
  // Step 5: Map to tier
  let tier;
  
  if (weightedScore < TIER_BOUNDARIES.simpleMedium) {
    tier = 'SIMPLE';
  } else if (weightedScore < TIER_BOUNDARIES.mediumComplex) {
    tier = 'MEDIUM';
  } else if (weightedScore < TIER_BOUNDARIES.complexReasoning) {
    tier = 'COMPLEX';
  } else {
    tier = 'REASONING';
  }
  
  return {
    tier,
    score: weightedScore,
    signals,
    reason: `Complexity score ${weightedScore.toFixed(2)} → ${tier}`,
  };
}

function resolveModel(tier, modelConfig) {
  const tierConfig = DEFAULT_TIERS[tier];
  
  // Check for config override
  const configModel = modelConfig?.[tier];
  if (configModel) {
    if (configModel.includes('/')) {
      const idx = configModel.indexOf('/');
      return {
        provider: configModel.slice(0, idx),
        model: configModel.slice(idx + 1),
      };
    }
    return { model: configModel };
  }
  
  // Use default
  const defaultModel = tierConfig.model;
  if (defaultModel.includes('/')) {
    const idx = defaultModel.indexOf('/');
    return {
      provider: defaultModel.slice(0, idx),
      model: defaultModel.slice(idx + 1),
    };
  }
  
  return { model: defaultModel };
}

// === Plugin Registration ===

function register(api, config) {
  const cfg = config || loadConfig() || {};
  const logDecisions = cfg.logDecisions !== false;
  const logger = api.logger;

  logger.info('[smart-router] Plugin loaded v4.0.0');

  // Verify api.on is available
  if (typeof api?.on !== 'function') {
    logger.error('[smart-router] ERROR: api.on() not available - plugin cannot function');
    return;
  }

  // Register hook for model resolution
  api.on('before_model_resolve', async (event, ctx) => {
    try {
      // Skip if disabled
      if (cfg.enabled === false) {
        return {};
      }

      const prompt = event?.prompt || '';
      
      // Skip empty prompts
      if (!prompt || !prompt.trim()) {
        return {};
      }

      // Classify the prompt
      const result = classifyPrompt(prompt, event);
      
      // Resolve model for tier
      const { model, provider } = resolveModel(result.tier, cfg.models || {});

      if (logDecisions) {
        logger.info(`[smart-router] ${result.reason} | signals: [${result.signals.join(', ')}] → ${provider ? `${provider}/` : ''}${model}`);
      }

      // Return the override
      const override = { modelOverride: model };
      if (provider) {
        override.providerOverride = provider;
      }

      return override;
    } catch (e) {
      logger.error(`[smart-router] Hook error: ${e.message}`);
      // Return empty on error to let default model selection proceed
      return {};
    }
  });

  logger.info('[smart-router] Hook registered: before_model_resolve');
}

// Export for CommonJS (OpenClaw plugin interface)
module.exports = {
  id: 'smart-router',
  name: 'Smart Router',
  description: 'Intelligent model routing based on prompt complexity',
  version: '4.0.0',
  configSchema: {
    jsonSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        logDecisions: { type: 'boolean', default: true },
        models: {
          type: 'object',
          properties: {
            SIMPLE: { type: 'string' },
            MEDIUM: { type: 'string' },
            COMPLEX: { type: 'string' },
            REASONING: { type: 'string' },
            MULTIMODAL: { type: 'string' },
            LONG_CONTEXT: { type: 'string' },
            FALLBACK: { type: 'string' },
          },
        },
      },
    },
  },
  register,
};