/**
 * Smart Router - Modality-Aware Version
 * 
 * Routes based on:
 * 1. Content type (text vs multimodal)
 * 2. Context length requirements
 * 3. Complexity scoring (14 dimensions)
 * 4. Model capabilities
 */

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
  return { models: {}, fallbackToLocal: false };
}

// === Tier Assignments based on Capability ===

// AWS Bedrock models (cross-region inference profiles)
const TIERS_BEDROCK = {
  // Text-only, fast for simple queries
  SIMPLE: {
    model: 'amazon-bedrock/us.amazon.nova-lite-v1:0',
    contextWindow: 300000,
    reasoning: false,
    modality: ['text'],
    useCase: 'Quick Q&A, definitions, short answers',
  },
  
  // Balanced for medium complexity
  MEDIUM: {
    model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
    contextWindow: 200000,
    reasoning: false,
    modality: ['text', 'vision'],
    useCase: 'Explanations, summaries, simple code',
  },
  
  // Primary for complex tasks
  COMPLEX: {
    model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
    contextWindow: 200000,
    reasoning: true,
    modality: ['text', 'vision'],
    useCase: 'Implementation, architecture, multi-step',
  },
  
  // Deep reasoning model
  REASONING: {
    model: 'amazon-bedrock/us.anthropic.claude-opus-4-6-v1',
    contextWindow: 200000,
    reasoning: true,
    modality: ['text', 'vision'],
    useCase: 'Proofs, formal logic, deep reasoning',
  },
  
  // Vision + text (screenshots, UI, diagrams)
  MULTIMODAL: {
    model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
    contextWindow: 200000,
    reasoning: true,
    modality: ['text', 'vision'],
    useCase: 'Images, screenshots, UI, diagrams',
  },
  
  // Ultra-long context
  LONG_CONTEXT: {
    model: 'amazon-bedrock/us.anthropic.claude-sonnet-4-6',
    contextWindow: 200000,
    reasoning: true,
    modality: ['text', 'vision'],
    useCase: 'Long documents, codebases, books',
  },
  
  // Fallback for edge cases
  FALLBACK: {
    model: 'amazon-bedrock/us.anthropic.claude-opus-4-6-v1',
    contextWindow: 200000,
    reasoning: true,
    modality: ['text', 'vision'],
    useCase: 'Fallback, largest model',
  },
};

// Ollama Cloud models (original)
const TIERS_CLOUD = {
  // Text-only, fast for simple queries
  SIMPLE: {
    model: 'nemotron-3-nano:30b-cloud',
    contextWindow: 131072,
    reasoning: false,
    modality: ['text'],
    useCase: 'Quick Q&A, definitions, short answers',
  },
  
  // Balanced for medium complexity
  MEDIUM: {
    model: 'glm-4.7:cloud',
    contextWindow: 131072,
    reasoning: false,
    modality: ['text'],
    useCase: 'Explanations, summaries, simple code',
  },
  
  // Primary for complex tasks
  COMPLEX: {
    model: 'glm-5:cloud',
    contextWindow: 131072,
    reasoning: true,
    modality: ['text'],
    useCase: 'Implementation, architecture, multi-step',
  },
  
  // MoE efficient, marked for reasoning
  REASONING: {
    model: 'minimax-m2.7:cloud',
    contextWindow: 204800, // 200K
    reasoning: true,
    modality: ['text'],
    useCase: 'Proofs, formal logic, deep reasoning',
  },
  
  // Vision + text (screenshots, UI, diagrams)
  MULTIMODAL: {
    model: 'kimi-k2.5:cloud',
    contextWindow: 262144, // 262K
    reasoning: true,
    modality: ['text', 'vision'],
    useCase: 'Images, screenshots, UI, diagrams',
  },
  
  // Ultra-long context
  LONG_CONTEXT: {
    model: 'nemotron-3-super:cloud',
    contextWindow: 524288, // 512K
    reasoning: true,
    modality: ['text'],
    useCase: 'Long documents, codebases, books',
  },
  
  // Fallback for edge cases
  FALLBACK: {
    model: 'mistral-large-3:675b-cloud',
    contextWindow: 262144, // 256K
    reasoning: false,
    modality: ['text', 'image'],
    useCase: 'Fallback, largest model',
  },
};

// Local model fallbacks (for users without Ollama Cloud)
const TIERS_LOCAL = {
  // Small, fast model for simple queries
  SIMPLE: {
    model: 'llama3.2:3b',
    contextWindow: 8192,
    reasoning: false,
    modality: ['text'],
    useCase: 'Quick Q&A, definitions, short answers',
  },
  
  // Balanced for medium complexity
  MEDIUM: {
    model: 'llama3.2:latest',
    contextWindow: 128000,
    reasoning: false,
    modality: ['text'],
    useCase: 'Explanations, summaries, simple code',
  },
  
  // Capable for complex tasks
  COMPLEX: {
    model: 'llama3.3:70b',
    contextWindow: 128000,
    reasoning: true,
    modality: ['text'],
    useCase: 'Implementation, architecture, multi-step',
  },
  
  // Deep reasoning model
  REASONING: {
    model: 'deepseek-r1:8b',
    contextWindow: 128000,
    reasoning: true,
    modality: ['text'],
    useCase: 'Proofs, formal logic, deep reasoning',
  },
  
  // Vision-capable model
  MULTIMODAL: {
    model: 'llava:13b',
    contextWindow: 8192,
    reasoning: false,
    modality: ['text', 'vision'],
    useCase: 'Images, screenshots, UI, diagrams',
  },
  
  // Long context model
  LONG_CONTEXT: {
    model: 'llama3.3:70b',
    contextWindow: 128000,
    reasoning: true,
    modality: ['text'],
    useCase: 'Long documents, codebases, books',
  },
  
  // Fallback
  FALLBACK: {
    model: 'llama3.3:70b',
    contextWindow: 128000,
    reasoning: true,
    modality: ['text'],
    useCase: 'Fallback, largest available model',
  },
};

// === Active Tier Resolution ===

function resolveActiveTiers() {
  const config = loadConfig();
  
  // Use TIERS_BEDROCK as default, allow per-tier env overrides
  let baseTiers = TIERS_BEDROCK;
  
  // Apply any configured model overrides
  const resolvedTiers = {};
  for (const [tier, config_] of Object.entries(baseTiers)) {
    // Check env override: SMART_ROUTER_SIMPLE_MODEL, etc.
    const envKey = `SMART_ROUTER_${tier}_MODEL`;
    const envModel = process.env[envKey];
    
    // Check config file override
    const configModel = config.models?.[tier];
    
    // Priority: env var > config file > base tier
    const model = envModel || configModel || config_.model;
    
    resolvedTiers[tier] = {
      ...config_,
      model,
      _source: envModel ? 'env' : (configModel ? 'config' : 'default'),
    };
  }
  
  return resolvedTiers;
}

// Legacy export for backward compatibility
const TIERS = TIERS_BEDROCK;

// Model capability lookup (from Ollama research)
const MODEL_CAPABILITIES = {
  'glm-4.7:cloud': {
    params: '300B',
    context: 131072,
    modality: ['text'],
    reasoning: false,
    swebench: null,
    contextLimit: false,
  },
  'glm-5:cloud': {
    params: '744B (40B active)',
    context: 131072,
    modality: ['text'],
    reasoning: true,
    aime: 92.7,
    swebench: 77.8,
    contextLimit: false,
  },
  'kimi-k2.5:cloud': {
    params: '1T (32B active)',
    context: 262144, // 262K
    modality: ['text', 'vision'],
    reasoning: true,
    thinking: true,
    swebench: 76.2,
    longContext: true,
  },
  'minimax-m2.7:cloud': {
    params: '456B (45.9B active)',
    context: 204800, // 200K
    modality: ['text'],
    reasoning: true,
    thinking: true,
    swepro: 56.22,
    toolathon: 46.3,
  },
  'nemotron-3-super:cloud': {
    params: '120B (12B active)',
    context: 524288, // 512K
    modality: ['text'],
    reasoning: true,
    configurableReasoning: true,
    taubench: 61.15,
  },
  'mistral-large-3:675b-cloud': {
    params: '675B',
    context: 262144, // 256K
    modality: ['text', 'image'],
    reasoning: false,
  },
};

// === Modality Detection ===

function detectModality(event) {
  const modalities = new Set(['text']);
  
  // Check for images in the message
  if (event?.messages) {
    for (const msg of event.messages) {
      // Image attachments
      if (msg.images?.length > 0 || msg.image?.url || msg.image?.base64) {
        modalities.add('vision');
      }
      // Image content parts
      if (msg.content && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image' || part.type === 'image_url' || part.image_url) {
            modalities.add('vision');
          }
        }
      }
      // Embedded images in text (base64 or URLs)
      if (typeof msg.content === 'string' && 
          (msg.content.includes('data:image') || 
           msg.content.includes('.png') ||
           msg.content.includes('.jpg') ||
           msg.content.includes('.jpeg') ||
           msg.content.includes('.gif') ||
           msg.content.includes('.webp'))) {
        modalities.add('vision');
      }
    }
  }
  
  // Check for file attachments
  if (event?.files?.length > 0) {
    for (const file of event.files) {
      if (file.type?.startsWith('image/')) {
        modalities.add('vision');
      }
    }
  }
  
  // Check for system prompt indicators
  const systemPrompt = event?.systemPrompt || '';
  if (systemPrompt.toLowerCase().includes('screenshot') ||
      systemPrompt.toLowerCase().includes('image') ||
      systemPrompt.toLowerCase().includes('diagram') ||
      systemPrompt.toLowerCase().includes('ui ')) {
    modalities.add('vision');
  }
  
  return Array.from(modalities);
}

function estimateTokenCount(text) {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function needsLongContext(event, estimatedTokens, promptText) {
  // Thresholds for long context
  const LONG_CONTEXT_THRESHOLD = 50000; // 50K tokens (lowered from 100K)
  const CODEBASE_THRESHOLD = 2; // Need 2+ codebase indicators for long context
  
  // Check token count
  if (estimatedTokens > LONG_CONTEXT_THRESHOLD) {
    return true;
  }
  
  // Combine prompt from parameter or event
  const prompt = (promptText || event?.prompt || '') + ' ' + (event?.systemPrompt || '');
  const lowerPrompt = prompt.toLowerCase();
  
  // Single strong indicator is enough (but not generic words like 'requirement', 'include')
  if (lowerPrompt.includes('entire codebase') ||
      lowerPrompt.includes('all files') ||
      lowerPrompt.includes('complete codebase') ||
      lowerPrompt.includes('whole repository') ||
      lowerPrompt.includes('entire repository')) {
    return true;
  }
  
  // Multiple file/codebase indicators (need 2+ specific mentions, not generic words)
  const specificMentions = (lowerPrompt.match(/codebase|repository|files\s+in|entire\s+\w+/g) || []).length;
  if (specificMentions >= 2) {
    return true;
  }
  
  // Long document indicators
  if (lowerPrompt.includes('entire book') ||
      lowerPrompt.includes('full document') ||
      lowerPrompt.includes('500-page') ||
      lowerPrompt.includes('all modules') ||
      lowerPrompt.includes('comprehensive analysis') ||
      lowerPrompt.includes('complete repository')) {
    return true;
  }
  
  // Context window limits from attached files
  if (event?.fileTokens && event.fileTokens > LONG_CONTEXT_THRESHOLD) {
    return true;
  }
  
  return false;
}

// === Enhanced Classification ===

const TIER_BOUNDARIES = {
  simpleMedium: 0.08,       // Lowered: Only clear trivia/greetings/definitions hit SIMPLE
  mediumComplex: 0.32,      // Moderate: MEDIUM in 0.08-0.32 range
  complexReasoning: 0.58,   // Higher: COMPLEX in 0.32-0.58 range
};

const CONFIDENCE_STEEPNESS = 10;
const CONFIDENCE_THRESHOLD = 0.45;

const KEYWORDS = {
  code: ["def ", "class ", "import ", "async ", "await ", "```", "func ", "struct ",
    "impl ", "interface ", "function(", "const ", "let ", "var ", "SELECT ",
    "implement ", "API endpoint", "REST API", "function that", "unit test",
    "python code", "javascript code", "code snippet", "create a function",
    "write a function", "write a script", "refactor", "debug", "add tests",
    "calculate", "sort", "parse"],
  // Note: "function" and "variable" removed - too generic. Now requires context like "function("
  reasoning: ["prove that", "theorem", "derive", "chain of thought",
    "formally", "mathematical proof", "logically", "show your reasoning",
    "demonstrate that", "reasoning chain", "deduce that",
    "think through", "reason through"],
  technical: ["algorithm", "optimize", "distributed system", "kubernetes",
    "microservice", "database", "infrastructure", "system design", "scalability",
    "latency", "throughput", "concurrency", "partition", "shard",
    "authentication", "security vulnerability", "deployment", "pipeline",
    "architecture", "API gateway", "REST API", "GraphQL API",
    "rust", "production system", "debugging", "profiling", "monitoring",
    "react", "vue", "python", "javascript", "node.js"],
  creative: ["story", "poem", "compose", "brainstorm", "creative", "imagine",
    "write a", "narrative", "fiction", "creative writing",
    "summarize", "summary of", "explain in detail"],
  simple: ["what is the", "what is a", "define", "translate", "hello", "yes or no", "capital of",
    "how old", "who is", "when was", "what are", "list", "what's the", "what's a",
    "tell me", "give me", "brief", "short", "quick", "simple question"],
  imperative: ["build", "create", "implement", "design", "develop", "construct",
    "generate", "deploy", "configure", "set up", "write", "fix", "refactor",
    "analyze", "investigate", "explain", "summarize", "read", "show me",
    "research", "compare", "evaluate", "review", "assess"],
  constraints: ["must be", "without", "only use", "exactly", "specifically",
    "ensure that", "requirement", "constraint", "limit", "maximum", "minimum"],
  outputFormat: ["json", "markdown", "table", "bullet", "list", "format", "csv", "yaml",
    "structured", "output as"],
  references: ["the above", "below", "section", "chapter", "figure", "table",
    "previous", "following", "mentioned", "reference", "citation"],
  negation: ["not", "never", "exclude", "but not", "except", "without",
    "avoid", "skip", "don't", "do not", "should not"],
  domain: ["legal", "medical", "financial", "constitutional", "statutory",
    "biological", "chemical", "physical", "economic", "political",
    "implications", "analysis"],
  agentic: ["using your tools", "spawn", "investigate", "analyze", "file",
    "read", "write", "edit", "browser", "search", "execute"],
  vision: ["screenshot", "screenshot of", "image shows", "diagram shows", "ui mockup", "visual interface",
    "picture shows", "photo of", "graph displays", "chart shows", "see the image", "analyze the image",
    "in this image", "attached image", "uploaded image"],
  longContext: ["entire", "all files", "complete codebase", "whole document",
    "full history", "everything", "comprehensive", "thorough analysis"],
};

const WEIGHTS = {
  tokenCount: 0.05,
  codePresence: 0.22,        // Increased: code is strong signal
  reasoningMarkers: 0.28,    // Increased: reasoning is strong signal
  technicalTerms: 0.18,      // Increased: technical content matters
  creativeMarkers: 0.08,
  simpleIndicators: -0.20,   // Moderate negative: simple queries
  multiStepPatterns: 0.15,   // Moderate: multi-step tasks
  questionComplexity: 0.05,
  imperativeVerbs: 0.18,     // Increased: imperative tasks
  constraintCount: 0.18,     // Increased: constraints are strong signals
  outputFormat: 0.06,        // Slight increase: format requirements
  referenceComplexity: 0.05,
  negationComplexity: 0.05,
  domainSpecificity: 0.15,   // Increased: domain knowledge
  agenticTask: 0.20,
  visionIndicators: 0.25,    // Vision signals
  longContextIndicators: 0.50, // Strong signal for long context
};

// === Main Classification Function ===

function classifyRequest(prompt, event = {}) {
  // Resolve active tiers (cloud vs local + overrides)
  const TIERS = resolveActiveTiers();
  
  const userText = prompt.toLowerCase();
  const systemPrompt = event?.systemPrompt || '';
  const combinedText = userText + ' ' + systemPrompt.toLowerCase();
  
  // Step 1: Detect modality
  const modalities = detectModality(event);
  
  // Check for embedded data:image in prompt text (base64 images embedded directly)
  const hasEmbeddedImage = /\bdata:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(prompt);
  if (hasEmbeddedImage && !modalities.includes('vision')) {
    modalities.push('vision');
  }
  
  const hasVision = modalities.includes('vision');
  
  // Step 2: Estimate token count for context needs
  const estimatedTokens = estimateTokenCount(prompt + systemPrompt);
  const needsLong = needsLongContext(event, estimatedTokens, prompt);
  
  // Step 3: If vision detected, route to MULTIMODAL
  if (hasVision) {
    return {
      tier: 'MULTIMODAL',
      confidence: 0.95,
      score: 0.50, // Vision flag adds 0.50
      signals: ['vision-detected', `modalities:${modalities.join(',')}`],
      modality: modalities,
      contextNeeds: needsLong ? 'long' : 'normal',
      estimatedTokens,
      model: TIERS.MULTIMODAL.model,
      modelSource: TIERS.MULTIMODAL._source,
      reason: 'Vision content detected → multimodal model',
    };
  }
  
  // Step 4: If long context needed, route to LONG_CONTEXT
  if (needsLong) {
    return {
      tier: 'LONG_CONTEXT',
      confidence: 0.90,
      score: 0.40, // Long context flag adds 0.40
      signals: ['long-context-required', `tokens:${estimatedTokens}`],
      modality: modalities,
      contextNeeds: 'long',
      estimatedTokens,
      model: TIERS.LONG_CONTEXT.model,
      modelSource: TIERS.LONG_CONTEXT._source,
      reason: 'Long context required → long context model',
    };
  }
  
  // Step 5: Standard complexity scoring
  const dimensions = [
    { name: 'codePresence', score: scoreKeywordMatch(combinedText, KEYWORDS.code, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 1.0 }) },
    { name: 'reasoningMarkers', score: scoreKeywordMatch(combinedText, KEYWORDS.reasoning, { low: 1, high: 2 }, { none: 0, low: 0.7, high: 1.0 }) },
    { name: 'technicalTerms', score: scoreKeywordMatch(combinedText, KEYWORDS.technical, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 1.0 }) },
    { name: 'creativeMarkers', score: scoreKeywordMatch(combinedText, KEYWORDS.creative, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 0.7 }) },
    { name: 'simpleIndicators', score: scoreKeywordMatch(combinedText, KEYWORDS.simple, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 1.0 }) },
    { name: 'imperativeVerbs', score: scoreKeywordMatch(combinedText, KEYWORDS.imperative, { low: 1, high: 2 }, { none: 0, low: 0.4, high: 0.6 }) },
    { name: 'constraintCount', score: scoreKeywordMatch(combinedText, KEYWORDS.constraints, { low: 1, high: 3 }, { none: 0, low: 0.3, high: 0.7 }) },
    { name: 'outputFormat', score: scoreKeywordMatch(combinedText, KEYWORDS.outputFormat, { low: 1, high: 2 }, { none: 0, low: 0.4, high: 0.7 }) },
    { name: 'domainSpecificity', score: scoreKeywordMatch(combinedText, KEYWORDS.domain, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 0.8 }) },
    { name: 'agenticTask', score: scoreAgenticTask(combinedText) },
    { name: 'visionIndicators', score: scoreKeywordMatch(combinedText, KEYWORDS.vision, { low: 1, high: 2 }, { none: 0, low: 0.8, high: 1.0 }) },
    { name: 'longContextIndicators', score: scoreKeywordMatch(combinedText, KEYWORDS.longContext, { low: 1, high: 2 }, { none: 0, low: 0.6, high: 0.9 }) },
  ];
  
  // Add token-based scoring
  const tokenScore = estimatedTokens < 500 ? -0.5 : (estimatedTokens > 5000 ? 0.5 : 0);
  dimensions.unshift({ name: 'tokenCount', score: tokenScore });
  
  // Calculate weighted score
  let weightedScore = 0;
  const signals = [];
  
  for (const dim of dimensions) {
    const weight = WEIGHTS[dim.name] ?? 0;
    weightedScore += dim.score * weight;
    if (dim.score !== 0 && Math.abs(dim.score) > 0.2) {
      signals.push(`${dim.name}:${dim.score > 0 ? '+' : ''}${dim.score.toFixed(1)}`);
    }
  }
  
  // Step 6: Check for reasoning override (single strong keyword OR 3+ reasoning keywords)
  const reasoningMatches = KEYWORDS.reasoning.filter(kw => combinedText.includes(kw.toLowerCase()));
  const strongReasoningKeywords = ['prove that', 'theorem', 'derive', 'formally', 'mathematical proof'];
  const strongMatches = strongReasoningKeywords.filter(kw => combinedText.includes(kw.toLowerCase()));
  
  // Single strong keyword is enough for reasoning override
  if (strongMatches.length >= 1 || reasoningMatches.length >= 3) {
    // Cap reasoning score to prevent overflow
    const cappedScore = Math.min(weightedScore, 0.95);
    return {
      tier: 'REASONING',
      confidence: 0.90,
      score: cappedScore,
      signals: [...signals, 'reasoning-override'],
      modality: modalities,
      contextNeeds: 'normal',
      estimatedTokens,
      model: TIERS.REASONING.model,
      modelSource: TIERS.REASONING._source,
      reason: 'Reasoning keywords detected → reasoning model',
    };
  }
  
  // Step 7: Map to tier
  let tier;
  let distanceFromBoundary;
  
  if (weightedScore < TIER_BOUNDARIES.simpleMedium) {
    tier = 'SIMPLE';
    distanceFromBoundary = TIER_BOUNDARIES.simpleMedium - weightedScore;
  } else if (weightedScore < TIER_BOUNDARIES.mediumComplex) {
    tier = 'MEDIUM';
    distanceFromBoundary = Math.min(weightedScore - TIER_BOUNDARIES.simpleMedium, TIER_BOUNDARIES.mediumComplex - weightedScore);
  } else if (weightedScore < TIER_BOUNDARIES.complexReasoning) {
    tier = 'COMPLEX';
    distanceFromBoundary = Math.min(weightedScore - TIER_BOUNDARIES.mediumComplex, TIER_BOUNDARIES.complexReasoning - weightedScore);
  } else {
    tier = 'REASONING';
    distanceFromBoundary = weightedScore - TIER_BOUNDARIES.complexReasoning;
  }
  
  const confidence = 1 / (1 + Math.exp(-CONFIDENCE_STEEPNESS * distanceFromBoundary));
  
  if (confidence < CONFIDENCE_THRESHOLD) {
    return {
      tier: null,
      confidence,
      score: weightedScore,
      signals,
      modality: modalities,
      contextNeeds: needsLong ? 'long' : 'normal',
      estimatedTokens,
      model: TIERS.COMPLEX.model, // Default to complex when ambiguous
      modelSource: TIERS.COMPLEX._source,
      reason: 'Ambiguous classification → default to complex',
    };
  }
  
  const tierConfig = TIERS[tier];
  
  return {
    tier,
    confidence,
    score: weightedScore,
    signals,
    modality: modalities,
    contextNeeds: needsLong ? 'long' : 'normal',
    estimatedTokens,
    model: tierConfig.model,
    modelSource: tierConfig._source,
    contextWindow: tierConfig.contextWindow,
    reason: `Score ${weightedScore.toFixed(2)} → ${tier} tier`,
  };
}

// === Helper Functions ===

function scoreKeywordMatch(text, keywords, thresholds, scores) {
  const matches = keywords.filter(kw => text.includes(kw.toLowerCase()));
  if (matches.length >= thresholds.high) return scores.high;
  if (matches.length >= thresholds.low) return scores.low;
  return scores.none;
}

function scoreAgenticTask(text) {
  const matches = KEYWORDS.agentic.filter(kw => text.includes(kw.toLowerCase()));
  if (matches.length >= 4) return 1.0;
  if (matches.length >= 3) return 0.6;
  if (matches.length >= 1) return 0.2;
  return 0;
}

// === Test Runner ===

function runTests() {
  const TIERS = resolveActiveTiers();
  
  const testCases = [
    // SIMPLE
    { prompt: "What is the capital of France?", expected: "SIMPLE" },
    { prompt: "Hello", expected: "SIMPLE" },
    { prompt: "Define polymorphism", expected: "SIMPLE" },
    
    // MEDIUM
    { prompt: "Explain how async/await works in JavaScript", expected: "MEDIUM" },
    { prompt: "Summarize this article about climate change", expected: "MEDIUM" },
    { prompt: "Create a function to calculate fibonacci", expected: "MEDIUM" },
    
    // COMPLEX
    { prompt: "Implement a REST API with authentication and database", expected: "COMPLEX" },
    { prompt: "Design a microservices architecture for an e-commerce platform", expected: "COMPLEX" },
    { prompt: "Refactor this code to use functional programming patterns and add tests", expected: "COMPLEX" },
    
    // REASONING
    { prompt: "Prove that the square root of 2 is irrational", expected: "REASONING" },
    { prompt: "Using formal logic, derive the conclusion step by step", expected: "REASONING" },
    
    // MULTIMODAL (with images)
    { prompt: "What's in this screenshot?", event: { messages: [{ images: ['screenshot.png'] }] }, expected: "MULTIMODAL" },
    { prompt: "Analyze this UI mockup for usability issues", event: { messages: [{ content: 'Analyze this UI mockup' }] }, expected: "COMPLEX" },
    
    // LONG_CONTEXT
    { prompt: "Analyze the entire codebase and identify all security vulnerabilities", expected: "LONG_CONTEXT" },
  ];
  
  console.log('\n=== Modality-Aware Smart Router Tests ===\n');
  console.log(`Model source: ${process.env.OLLAMA_CLOUD_ENABLED === 'true' ? 'cloud' : 'local'}\n`);
  
  let passed = 0;
  let failed = 0;
  
  for (const tc of testCases) {
    const result = classifyRequest(tc.prompt, tc.event || {});
    const pass = result.tier === tc.expected;
    const status = pass ? '✓' : '✗';
    
    console.log(`${status} [${tc.expected}]`);
    console.log(`    Prompt: "${tc.prompt.slice(0, 50)}..."`);
    console.log(`    Got: ${result.tier} (conf: ${result.confidence.toFixed(2)}, score: ${result.score.toFixed(2)})`);
    console.log(`    Model: ${result.model} (${result.modelSource || 'default'})`);
    if (result.signals.length > 0) {
      console.log(`    Signals: ${result.signals.slice(0, 5).join(', ')}`);
    }
    if (result.modality?.length > 1 || result.modality?.[0] !== 'text') {
      console.log(`    Modality: ${result.modality?.join('+')}`);
    }
    console.log();
    
    if (pass) passed++;
    else failed++;
  }
  
  console.log(`=== Results: ${passed}/${testCases.length} passed, ${failed} failed ===\n`);
  
  // Print tier summary
  console.log('=== Tier Summary ===\n');
  for (const [tier, config] of Object.entries(TIERS)) {
    console.log(`${tier}: ${config.model}`);
    console.log(`  Source: ${config._source || 'default'}`);
    console.log(`  Context: ${(config.contextWindow / 1024).toFixed(0)}K tokens`);
    console.log(`  Modality: ${config.modality.join('+')}`);
    console.log(`  Use case: ${config.useCase}`);
    console.log();
  }
}

// === CLI ===

const args = process.argv.slice(2);
if (args.length === 0) {
  runTests();
} else if (args[0] === '--test') {
  runTests();
} else if (args[0] === '--tiers') {
  const TIERS = resolveActiveTiers();
  const isCloud = process.env.OLLAMA_CLOUD_ENABLED === 'true';
  const forceLocal = process.env.SMART_ROUTER_FORCE_LOCAL === 'true';
  const forceCloud = process.env.SMART_ROUTER_FORCE_CLOUD === 'true';
  
  let mode = 'local';
  if (forceCloud && isCloud) mode = 'cloud (forced)';
  else if (forceLocal) mode = 'local (forced)';
  else if (isCloud) mode = 'cloud';
  
  console.log('\n=== Available Tiers ===\n');
  console.log(`Mode: ${mode}\n`);
  
  for (const [tier, config] of Object.entries(TIERS)) {
    console.log(`${tier}: ${config.model}`);
    console.log(`  Source: ${config._source || 'default'}`);
    console.log(`  Context: ${(config.contextWindow / 1024).toFixed(0)}K`);
    console.log(`  Modality: ${config.modality.join('+')}`);
    console.log(`  Use: ${config.useCase}`);
    console.log();
  }
  
  console.log('=== Configuration Sources ===\n');
  console.log('Priority: env var > config.json > default');
  console.log('Env vars: SMART_ROUTER_SIMPLE_MODEL, SMART_ROUTER_MEDIUM_MODEL, etc.');
  console.log('Config file: plugins/smart-router/config.json');
} else if (args[0] === '--modality') {
  console.log('\n=== Multimodal Models ===\n');
  for (const [model, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (caps.modality.length > 1 || caps.modality.includes('vision')) {
      console.log(`${model}`);
      console.log(`  Modality: ${caps.modality.join('+')}`);
      console.log(`  Context: ${(caps.context / 1024).toFixed(0)}K`);
      console.log();
    }
  }
} else if (args[0] === '--config') {
  const config = loadConfig();
  console.log('\n=== Current Configuration ===\n');
  console.log(JSON.stringify(config, null, 2));
  console.log('\nEnvironment overrides:');
  console.log(`  OLLAMA_CLOUD_ENABLED: ${process.env.OLLAMA_CLOUD_ENABLED || '(not set)'}`);
  console.log(`  SMART_ROUTER_FORCE_LOCAL: ${process.env.SMART_ROUTER_FORCE_LOCAL || '(not set)'}`);
  console.log(`  SMART_ROUTER_FORCE_CLOUD: ${process.env.SMART_ROUTER_FORCE_CLOUD || '(not set)'}`);
  for (const tier of Object.keys(TIERS_CLOUD)) {
    const envKey = `SMART_ROUTER_${tier}_MODEL`;
    if (process.env[envKey]) {
      console.log(`  ${envKey}: ${process.env[envKey]}`);
    }
  }
  console.log();
} else {
  // Interactive test
  const prompt = args.join(' ');
  const result = classifyRequest(prompt, {});
  
  console.log('\n=== Classification Result ===\n');
  console.log(`Prompt: "${prompt}"`);
  console.log(`\nTier: ${result.tier || 'AMBIGUOUS'}`);
  console.log(`Model: ${result.model} (${result.modelSource || 'default'})`);
  console.log(`Confidence: ${result.confidence.toFixed(2)}`);
  console.log(`Score: ${result.score.toFixed(3)}`);
  console.log(`Modality: ${result.modality?.join('+') || 'text'}`);
  console.log(`Context: ${result.contextNeeds || 'normal'} (${result.estimatedTokens} tokens)`);
  if (result.signals.length > 0) {
    console.log(`\nSignals:`);
    result.signals.forEach(s => console.log(`  - ${s}`));
  }
  console.log(`\nReason: ${result.reason}`);
  console.log();
}

module.exports = {
  classifyRequest,
  detectModality,
  needsLongContext,
  resolveActiveTiers,
  loadConfig,
  TIERS_BEDROCK,
  TIERS_CLOUD,
  TIERS_LOCAL,
  MODEL_CAPABILITIES,
};