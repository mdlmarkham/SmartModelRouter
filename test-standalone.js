/**
 * Smart Router - Standalone test (v2 with tuned weights)
 * 
 * Run with: node test-standalone.js
 */

// Tier assignment boundaries - tuned for actual score distribution
const TIER_BOUNDARIES = {
  simpleMedium: 0.15,   // Below 0.15 = truly simple
  mediumComplex: 0.28,  // 0.15-0.28 = medium
  complexReasoning: 0.50, // 0.28-0.50 = complex
};

const CONFIDENCE_STEEPNESS = 10;
const CONFIDENCE_THRESHOLD = 0.45;  // Lowered - accept more classifications

const KEYWORDS = {
  code: [
    "function", "class", "import", "def", "SELECT", "async", "await", "const",
    "let", "var", "return", "```", "func", "struct", "interface", "impl",
    "implement", "code", "API", "REST", "function"
  ],
  reasoning: [
    "prove", "theorem", "derive", "step by step", "chain of thought",
    "formally", "mathematical", "proof", "logically", "prove that",
    "show that", "demonstrate", "reasoning", "deduce", "derive"
  ],
  technical: [
    "algorithm", "optimize", "architecture", "distributed", "kubernetes",
    "microservice", "database", "infrastructure", "system design", "scalability",
    "latency", "throughput", "concurrency", "partition", "shard",
    "authentication", "security", "deployment", "pipeline"
  ],
  creative: [
    "story", "poem", "compose", "brainstorm", "creative", "imagine",
    "write a", "narrative", "fiction", "creative writing"
  ],
  simple: [
    "what is", "define", "translate", "hello", "yes or no", "capital of",
    "how old", "who is", "when was", "what are", "list", "what's"
  ],
  imperative: [
    "build", "create", "implement", "design", "develop", "construct",
    "generate", "deploy", "configure", "set up", "write", "fix", "refactor",
    "analyze", "investigate", "explain", "summarize"
  ],
  constraints: [
    "must be", "without", "only use", "exactly", "specifically",
    "ensure that", "requirement", "constraint", "limit", "maximum", "minimum"
  ],
  outputFormat: [
    "json", "markdown", "table", "bullet", "list", "format", "csv", "yaml",
    "structured", "output as"
  ],
  references: [
    "the above", "below", "section", "chapter", "figure", "table",
    "previous", "following", "mentioned", "reference", "citation"
  ],
  negation: [
    "not", "never", "exclude", "but not", "except", "without",
    "avoid", "skip", "don't", "do not", "should not"
  ],
  domain: [
    "legal", "medical", "financial", "constitutional", "statutory",
    "biological", "chemical", "physical", "economic", "political",
    "implications", "analysis"
  ],
  agentic: [
    "using your tools", "spawn", "investigate", "analyze", "file",
    "read", "write", "edit", "browser", "search", "execute"
  ],
};

// Tuned weights - token count less dominant, complexity markers stronger
const WEIGHTS = {
  tokenCount: 0.05,        
  codePresence: 0.20,      
  reasoningMarkers: 0.25,   
  technicalTerms: 0.15,    
  creativeMarkers: 0.08,    
  simpleIndicators: -0.15, 
  multiStepPatterns: 0.12,  
  questionComplexity: 0.05,
  imperativeVerbs: 0.12,    
  constraintCount: 0.10,    
  outputFormat: 0.05,
  referenceComplexity: 0.05,
  negationComplexity: 0.05,
  domainSpecificity: 0.12,  
  agenticTask: 0.18,        
};

const TOKEN_THRESHOLDS = { simple: 30, complex: 400 };

const DEFAULT_TIERS = {
  SIMPLE: "minimax-m2.7:cloud",
  MEDIUM: "qwen3.5:397b-cloud",
  COMPLEX: "glm-5:cloud",
  REASONING: "nemotron-3-super:cloud",
};

// Utility functions
function tokenize(text) {
  return Math.ceil(text.length / 4);
}

function scoreKeywordMatch(text, keywords, thresholds, scores) {
  const matches = keywords.filter((kw) => text.includes(kw.toLowerCase()));
  if (matches.length >= thresholds.high) return scores.high;
  if (matches.length >= thresholds.low) return scores.low;
  return scores.none;
}

function scoreTokenCount(tokens) {
  if (tokens < TOKEN_THRESHOLDS.simple) return -0.5;  // Less punitive
  if (tokens > TOKEN_THRESHOLDS.complex) return 0.5;   // Less bonus
  return 0;
}

function scoreMultiStep(text) {
  const patterns = [/first.*then/i, /step \d/i, /\d\.\s/, /then.*finally/i];
  const hits = patterns.filter((p) => p.test(text));
  return hits.length > 0 ? Math.min(hits.length * 0.15, 0.5) : 0;
}

function scoreQuestionComplexity(text) {
  const count = (text.match(/\?/g) || []).length;
  return count > 3 ? 0.3 : 0;
}

function scoreAgenticTask(text) {
  const matches = KEYWORDS.agentic.filter((kw) => text.includes(kw.toLowerCase()));
  if (matches.length >= 4) return 1.0;
  if (matches.length >= 3) return 0.6;
  if (matches.length >= 1) return 0.2;
  return 0;
}

function calibrateConfidence(distance) {
  return 1 / (1 + Math.exp(-CONFIDENCE_STEEPNESS * distance));
}

// Main classification function
function classifyRequest(prompt, systemPrompt) {
  const userText = prompt.toLowerCase();
  const totalTokens = tokenize(prompt + (systemPrompt || ""));

  const dimensions = [
    { name: "tokenCount", score: scoreTokenCount(totalTokens) },
    { name: "codePresence", score: scoreKeywordMatch(userText, KEYWORDS.code, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 1.0 }) },
    { name: "reasoningMarkers", score: scoreKeywordMatch(userText, KEYWORDS.reasoning, { low: 1, high: 2 }, { none: 0, low: 0.7, high: 1.0 }) },
    { name: "technicalTerms", score: scoreKeywordMatch(userText, KEYWORDS.technical, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 1.0 }) },
    { name: "creativeMarkers", score: scoreKeywordMatch(userText, KEYWORDS.creative, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 0.7 }) },
    { name: "simpleIndicators", score: scoreKeywordMatch(userText, KEYWORDS.simple, { low: 1, high: 2 }, { none: 0, low: -0.5, high: -1.0 }) },
    { name: "multiStepPatterns", score: scoreMultiStep(userText) },
    { name: "questionComplexity", score: scoreQuestionComplexity(prompt) },
    { name: "imperativeVerbs", score: scoreKeywordMatch(userText, KEYWORDS.imperative, { low: 1, high: 2 }, { none: 0, low: 0.4, high: 0.6 }) },
    { name: "constraintCount", score: scoreKeywordMatch(userText, KEYWORDS.constraints, { low: 1, high: 3 }, { none: 0, low: 0.3, high: 0.7 }) },
    { name: "outputFormat", score: scoreKeywordMatch(userText, KEYWORDS.outputFormat, { low: 1, high: 2 }, { none: 0, low: 0.4, high: 0.7 }) },
    { name: "referenceComplexity", score: scoreKeywordMatch(userText, KEYWORDS.references, { low: 1, high: 2 }, { none: 0, low: 0.3, high: 0.5 }) },
    { name: "negationComplexity", score: scoreKeywordMatch(userText, KEYWORDS.negation, { low: 2, high: 3 }, { none: 0, low: 0.3, high: 0.5 }) },
    { name: "domainSpecificity", score: scoreKeywordMatch(userText, KEYWORDS.domain, { low: 1, high: 2 }, { none: 0, low: 0.5, high: 0.8 }) },
  ];

  const agenticScore = scoreAgenticTask(userText);
  dimensions.push({ name: "agenticTask", score: agenticScore });

  let weightedScore = 0;
  const signals = [];

  for (const dim of dimensions) {
    const weight = WEIGHTS[dim.name] ?? 0;
    weightedScore += dim.score * weight;
    if (dim.score !== 0 && Math.abs(dim.score) > 0.2) {
      signals.push(`${dim.name}:${dim.score > 0 ? '+' : ''}${dim.score.toFixed(1)}`);
    }
  }

  // Reasoning override (2+ keywords = REASONING)
  const reasoningMatches = KEYWORDS.reasoning.filter((kw) => userText.includes(kw.toLowerCase()));
  if (reasoningMatches.length >= 2) {
    return { tier: "REASONING", confidence: 0.9, score: weightedScore, signals: [...signals, "reasoning-override"], agenticScore };
  }

  // Map to tier
  let tier;
  let distanceFromBoundary;

  if (weightedScore < TIER_BOUNDARIES.simpleMedium) {
    tier = "SIMPLE";
    distanceFromBoundary = TIER_BOUNDARIES.simpleMedium - weightedScore;
  } else if (weightedScore < TIER_BOUNDARIES.mediumComplex) {
    tier = "MEDIUM";
    distanceFromBoundary = Math.min(weightedScore - TIER_BOUNDARIES.simpleMedium, TIER_BOUNDARIES.mediumComplex - weightedScore);
  } else if (weightedScore < TIER_BOUNDARIES.complexReasoning) {
    tier = "COMPLEX";
    distanceFromBoundary = Math.min(weightedScore - TIER_BOUNDARIES.mediumComplex, TIER_BOUNDARIES.complexReasoning - weightedScore);
  } else {
    tier = "REASONING";
    distanceFromBoundary = weightedScore - TIER_BOUNDARIES.complexReasoning;
  }

  const confidence = calibrateConfidence(distanceFromBoundary);

  if (confidence < CONFIDENCE_THRESHOLD) {
    return { tier: null, confidence, score: weightedScore, signals, agenticScore };
  }

  return { tier, confidence, score: weightedScore, signals, agenticScore };
}

// Test runner
function runTests() {
  const testCases = [
    // SIMPLE: Greetings, simple questions, translations
    { prompt: "What is the capital of France?", expected: "SIMPLE", name: "simple-fact" },
    { prompt: "Hello", expected: "SIMPLE", name: "greeting" },
    { prompt: "Translate 'hello' to Spanish", expected: "SIMPLE", name: "translate" },
    { prompt: "What is the meaning of life?", expected: "SIMPLE", name: "philosophical-simple" },
    
    // MEDIUM: Explanations, summaries, single-file code tasks
    { prompt: "Summarize this article about climate change", expected: "MEDIUM", name: "summarize" },
    { prompt: "Explain how async/await works in JavaScript", expected: "MEDIUM", name: "explain-technical" },
    { prompt: "Create a function that calculates fibonacci numbers", expected: "MEDIUM", name: "code-simple" },
    { prompt: "Write a short story about a robot learning to paint", expected: "MEDIUM", name: "creative" },
    
    // COMPLEX: Multi-file implementations, architecture, multi-step tasks
    { prompt: "Implement a REST API with authentication and database", expected: "COMPLEX", name: "implement-api" },
    { prompt: "Design a microservices architecture for an e-commerce platform", expected: "COMPLEX", name: "architecture" },
    { prompt: "Using your tools, investigate the security issue and fix it", expected: "COMPLEX", name: "agentic" },
    { prompt: "First analyze the requirements, then design the schema, finally implement", expected: "COMPLEX", name: "multi-step" },
    { prompt: "Analyze the constitutional implications of the Supreme Court's decision", expected: "COMPLEX", name: "legal-analysis" },
    { prompt: "Refactor this code to use functional programming patterns and add tests", expected: "COMPLEX", name: "refactor-complex" },
    
    // REASONING: Proofs, formal logic, mathematical derivations
    { prompt: "Prove that the square root of 2 is irrational", expected: "REASONING", name: "math-proof" },
    { prompt: "Using formal logic, derive the conclusion step by step", expected: "REASONING", name: "formal-logic" },
  ];

  console.log("\n=== Smart Router Test Suite (v2) ===\n");

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const result = classifyRequest(tc.prompt, undefined);
    const match = result.tier === tc.expected;
    const status = match ? "✓" : "✗";
    const model = result.tier ? DEFAULT_TIERS[result.tier] : "default";

    console.log(`${status} [${tc.name}]`);
    console.log(`    Prompt: "${tc.prompt.slice(0, 50)}..."`);
    console.log(`    Expected: ${tc.expected}, Got: ${result.tier ?? "AMBIGUOUS"}`);
    console.log(`    Confidence: ${result.confidence.toFixed(2)}, Score: ${result.score.toFixed(3)}`);
    console.log(`    Model: ${model}`);
    if (result.signals.length > 0) {
      console.log(`    Signals: ${result.signals.slice(0, 5).join(", ")}`);
    }
    console.log();

    if (match) passed++;
    else failed++;
  }

  console.log(`=== Results: ${passed}/${testCases.length} passed, ${failed} failed ===\n`);
}

// Interactive test
function testPrompt(prompt) {
  const result = classifyRequest(prompt, undefined);
  const model = result.tier ? DEFAULT_TIERS[result.tier] : "default";

  console.log("\n=== Routing Classification ===\n");
  console.log(`Prompt: "${prompt}"`);
  console.log(`\nTier:        ${result.tier ?? "AMBIGUOUS"}`);
  console.log(`Confidence:  ${result.confidence.toFixed(2)}`);
  console.log(`Score:       ${result.score.toFixed(3)}`);
  console.log(`Agentic:     ${result.agenticScore.toFixed(2)}`);
  console.log(`\nModel:       ${model}`);
  if (result.signals.length > 0) {
    console.log(`\nSignals:`);
    result.signals.forEach(s => console.log(`  - ${s}`));
  }
  console.log();
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  runTests();
} else if (args[0] === "--test") {
  runTests();
} else {
  testPrompt(args.join(" "));
}