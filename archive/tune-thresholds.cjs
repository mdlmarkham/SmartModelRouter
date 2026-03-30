/**
 * Threshold Tuning & Cost Tracking System
 * 
 * Tunes tier boundaries based on test outcomes
 * Tracks token usage by tier for cost analysis
 */

const fs = require('fs');
const path = require('path');

// === Configurable Thresholds ===

let THRESHOLDS = {
  simpleMedium: 0.20,      // Below = SIMPLE, above = MEDIUM
  mediumComplex: 0.40,     // Below = MEDIUM, above = COMPLEX
  complexReasoning: 0.60,  // Below = COMPLEX, above = REASONING
  reasoningKeywordCount: 2, // Number of reasoning keywords for override
};

// === Cost Tracking (for token-based pricing) ===

const MODEL_COSTS = {
  'glm-4.7:cloud': { input: 0.10, output: 0.30 },  // $/M tokens (estimated)
  'glm-5:cloud': { input: 0.50, output: 1.50 },
  'kimi-k2.5:cloud': { input: 0.40, output: 1.20 },
  'minimax-m2.7:cloud': { input: 0.60, output: 1.80 },
  'nematron-3-super:cloud': { input: 0.30, output: 0.90 },
  'mistral-large-3:675b-cloud': { input: 2.00, output: 6.00 },
};

// Tracking state
let usageLog = [];
const COST_LOG_PATH = path.join(__dirname, 'cost-log.jsonl');

// === Threshold Tuning ===

function tuneThresholds(testResults, learningRate = 0.05) {
  const adjustments = [];
  
  // Group results by expected tier
  const byExpected = {
    SIMPLE: [],
    MEDIUM: [],
    COMPLEX: [],
    REASONING: [],
    MULTIMODAL: [],
    LONG_CONTEXT: [],
  };
  
  for (const result of testResults) {
    if (byExpected[result.expected]) {
      byExpected[result.expected].push(result);
    }
  }
  
  // Analyze SIMPLE tier - should be below simpleMedium threshold
  const simpleScores = byExpected.SIMPLE.map(r => r.score);
  if (simpleScores.length > 0) {
    const maxSimpleScore = Math.max(...simpleScores);
    if (maxSimpleScore > THRESHOLDS.simpleMedium) {
      // Too many SIMPLE queries scoring above threshold
      THRESHOLDS.simpleMedium = Math.max(0.15, THRESHOLDS.simpleMedium + learningRate * (maxSimpleScore - THRESHOLDS.simpleMedium));
      adjustments.push({
        threshold: 'simpleMedium',
        action: 'increased',
        value: THRESHOLDS.simpleMedium,
        reason: `Max SIMPLE score (${maxSimpleScore.toFixed(2)}) was above threshold`,
      });
    }
  }
  
  // Analyze MEDIUM tier
  const mediumScores = byExpected.MEDIUM.map(r => r.score);
  if (mediumScores.length > 0) {
    const minMediumScore = Math.min(...mediumScores);
    const maxMediumScore = Math.max(...mediumScores);
    
    if (minMediumScore < THRESHOLDS.simpleMedium) {
      THRESHOLDS.simpleMedium = Math.max(0.10, THRESHOLDS.simpleMedium - learningRate * (THRESHOLDS.simpleMedium - minMediumScore));
      adjustments.push({
        threshold: 'simpleMedium',
        action: 'decreased',
        value: THRESHOLDS.simpleMedium,
        reason: `Min MEDIUM score (${minMediumScore.toFixed(2)}) was below threshold`,
      });
    }
    
    if (maxMediumScore > THRESHOLDS.mediumComplex) {
      THRESHOLDS.mediumComplex = Math.max(THRESHOLDS.simpleMedium + 0.05, THRESHOLDS.mediumComplex + learningRate * (maxMediumScore - THRESHOLDS.mediumComplex));
      adjustments.push({
        threshold: 'mediumComplex',
        action: 'increased',
        value: THRESHOLDS.mediumComplex,
        reason: `Max MEDIUM score (${maxMediumScore.toFixed(2)}) was above threshold`,
      });
    }
  }
  
  // Analyze COMPLEX tier
  const complexScores = byExpected.COMPLEX.map(r => r.score);
  if (complexScores.length > 0) {
    const minComplexScore = Math.min(...complexScores);
    
    if (minComplexScore < THRESHOLDS.mediumComplex) {
      THRESHOLDS.mediumComplex = Math.max(THRESHOLDS.simpleMedium + 0.05, THRESHOLDS.mediumComplex - learningRate * (THRESHOLDS.mediumComplex - minComplexScore));
      adjustments.push({
        threshold: 'mediumComplex',
        action: 'decreased',
        value: THRESHOLDS.mediumComplex,
        reason: `Min COMPLEX score (${minComplexScore.toFixed(2)}) was below threshold`,
      });
    }
    
    // Complex should typically be above threshold
    const avgComplexScore = complexScores.reduce((a, b) => a + b, 0) / complexScores.length;
    if (avgComplexScore < THRESHOLDS.mediumComplex + 0.1) {
      // Complex queries scoring too low - increase complexity signals
      adjustments.push({
        threshold: 'complexSignalBoost',
        action: 'suggested',
        value: '+0.10 to complexity weights',
        reason: `Avg COMPLEX score (${avgComplexScore.toFixed(2)}) is near threshold edge`,
      });
    }
  }
  
  return {
    thresholds: THRESHOLDS,
    adjustments,
  };
}

// === Cost Tracking ===

function logUsage(tier, model, inputTokens, outputTokens) {
  const costs = MODEL_COSTS[model] || { input: 0, output: 0 };
  const cost = (inputTokens / 1000000 * costs.input) + (outputTokens / 1000000 * costs.output);
  
  const entry = {
    timestamp: new Date().toISOString(),
    tier,
    model,
    inputTokens,
    outputTokens,
    costUsd: cost,
    flatFee: true, // Matt's case
  };
  
  usageLog.push(entry);
  
  // Persist
  try {
    fs.appendFileSync(COST_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Silently fail if can't log
  }
  
  return entry;
}

function getUsageStats() {
  const byTier = {};
  const byModel = {};
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  
  for (const entry of usageLog) {
    // By tier
    if (!byTier[entry.tier]) {
      byTier[entry.tier] = { count: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    }
    byTier[entry.tier].count++;
    byTier[entry.tier].inputTokens += entry.inputTokens;
    byTier[entry.tier].outputTokens += entry.outputTokens;
    byTier[entry.tier].cost += entry.costUsd;
    
    // By model
    if (!byModel[entry.model]) {
      byModel[entry.model] = { count: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
    }
    byModel[entry.model].count++;
    byModel[entry.model].inputTokens += entry.inputTokens;
    byModel[entry.model].outputTokens += entry.outputTokens;
    byModel[entry.model].cost += entry.costUsd;
    
    totalCost += entry.costUsd;
    totalInputTokens += entry.inputTokens;
    totalOutputTokens += entry.outputTokens;
  }
  
  return {
    totalRequests: usageLog.length,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd: totalCost,
    byTier,
    byModel,
  };
}

function calculateSavings(baselineModel = 'glm-5:cloud') {
  const baseline = MODEL_COSTS[baselineModel] || { input: 0.50, output: 1.50 };
  
  let baselineCost = 0;
  let actualCost = 0;
  
  for (const entry of usageLog) {
    baselineCost += (entry.inputTokens / 1000000 * baseline.input) + (entry.outputTokens / 1000000 * baseline.output);
    actualCost += entry.costUsd;
  }
  
  return {
    baselineCostUsd: baselineCost,
    actualCostUsd: actualCost,
    savingsUsd: baselineCost - actualCost,
    savingsPercent: baselineCost > 0 ? ((baselineCost - actualCost) / baselineCost * 100) : 0,
    baselineModel,
  };
}

// === Comprehensive Test Suite ===

const COMPREHENSIVE_TESTS = [
  // === SIMPLE (expected score < 0.20) ===
  { prompt: "What is the capital of France?", expected: "SIMPLE", reason: "Basic factual question" },
  { prompt: "Hello", expected: "SIMPLE", reason: "Greeting" },
  { prompt: "Define polymorphism", expected: "SIMPLE", reason: "Definition request" },
  { prompt: "What time is it?", expected: "SIMPLE", reason: "Simple query" },
  { prompt: "Translate 'hello' to Spanish", expected: "SIMPLE", reason: "Simple translation" },
  { prompt: "Who is the president?", expected: "SIMPLE", reason: "Factual question" },
  { prompt: "List the primary colors", expected: "SIMPLE", reason: "Simple enumeration" },
  
  // === MEDIUM (expected score 0.20-0.40) ===
  { prompt: "Explain how async/await works in JavaScript", expected: "MEDIUM", reason: "Technical explanation" },
  { prompt: "Summarize this article about climate change", expected: "MEDIUM", reason: "Summarization task" },
  { prompt: "Create a function to calculate fibonacci numbers", expected: "MEDIUM", reason: "Simple coding task" },
  { prompt: "What is the difference between let and const?", expected: "MEDIUM", reason: "Comparison question" },
  { prompt: "Write a simple loop in Python", expected: "MEDIUM", reason: "Basic code generation" },
  { prompt: "Explain the concept of recursion", expected: "MEDIUM", reason: "Conceptual explanation" },
  
  // === COMPLEX (expected score 0.40-0.60) ===
  { prompt: "Implement a REST API with authentication and database connectivity using Express.js and PostgreSQL", expected: "COMPLEX", reason: "Multi-part implementation" },
  { prompt: "Design a microservices architecture for an e-commerce platform that handles 10K requests per second", expected: "COMPLEX", reason: "Architecture design with constraints" },
  { prompt: "Build a real-time chat application with WebSockets, message persistence, and user presence", expected: "COMPLEX", reason: "Multi-component system" },
  { prompt: "Refactor this code to use functional programming patterns, add comprehensive tests, and optimize for performance", expected: "COMPLEX", reason: "Multi-step task with constraints" },
  { prompt: "Analyze the constitutional implications of the Supreme Court's decision and its impact on future legislation", expected: "COMPLEX", reason: "Domain-specific analysis" },
  { prompt: "Using your tools, investigate the security vulnerability in the authentication module and propose fixes", expected: "COMPLEX", reason: "Agentic task" },
  
  // === REASONING (reasoning keywords or score > 0.60) ===
  { prompt: "Prove that the square root of 2 is irrational using mathematical proof", expected: "REASONING", reason: "Mathematical proof" },
  { prompt: "Using formal logic, derive the conclusion from the premises step by step", expected: "REASONING", reason: "Formal logic" },
  { prompt: "Demonstrate why the halting problem is undecidable", expected: "REASONING", reason: "Theoretical proof" },
  { prompt: "Explain the proof of Fermat's Last Theorem", expected: "REASONING", reason: "Mathematical reasoning" },
  
  // === MULTIMODAL (vision content) ===
  { prompt: "What's in this screenshot?", expected: "MULTIMODAL", event: { messages: [{ images: ['screenshot.png'] }] }, reason: "Image attached" },
  { prompt: "Analyze this UI mockup for usability issues", expected: "COMPLEX", reason: "UI analysis (no image but vision keywords)" },
  { prompt: "Describe the architecture shown in this diagram", expected: "MULTIMODAL", event: { messages: [{ content: 'Describe the architecture in this diagram', images: ['diagram.png'] }] }, reason: "Image attached" },
  
  // === LONG_CONTEXT (long document indicators) ===
  { prompt: "Analyze the entire codebase and identify all security vulnerabilities across all modules", expected: "LONG_CONTEXT", reason: "Large codebase analysis" },
  { prompt: "Review the full 500-page technical specification and summarize key requirements", expected: "LONG_CONTEXT", reason: "Long document" },
  { prompt: "Process all the files in this repository and generate comprehensive documentation", expected: "LONG_CONTEXT", reason: "Multiple files" },
  
  // === EDGE CASES ===
  { prompt: "First analyze the requirements, then design the schema, finally implement the API endpoints", expected: "COMPLEX", reason: "Multi-step imperative" },
  { prompt: "I need you to use your tools to read the configuration file, parse the JSON, validate the schema, and then generate a report", expected: "COMPLEX", reason: "Multi-tool agentic task" },
  { prompt: "What is the meaning of life?", expected: "SIMPLE", reason: "Philosophical but simple structure" },
  { prompt: "Write me a story about a robot", expected: "MEDIUM", reason: "Creative writing (medium complexity)" },
];

// === Run Comprehensive Tests ===

function runComprehensiveTests() {
  const { classifyRequest } = require('./router-modality.cjs');
  
  console.log('\n=== Comprehensive Test Suite ===\n');
  console.log(`Running ${COMPREHENSIVE_TESTS.length} tests...\n`);
  
  const results = [];
  let passed = 0;
  let failed = 0;
  
  const byExpected = {};
  
  for (const tc of COMPREHENSIVE_TESTS) {
    const result = classifyRequest(tc.prompt, tc.event || {});
    const pass = result.tier === tc.expected;
    
    byExpected[tc.expected] = byExpected[tc.expected] || [];
    byExpected[tc.expected].push({
      prompt: tc.prompt,
      score: result.score,
      tier: result.tier,
      pass,
    });
    
    results.push({
      expected: tc.expected,
      actual: result.tier,
      score: result.score,
      confidence: result.confidence,
      pass,
      reason: tc.reason,
    });
    
    if (pass) passed++;
    else failed++;
  }
  
  // Print summary by expected tier
  console.log('=== Results by Expected Tier ===\n');
  for (const [tier, tests] of Object.entries(byExpected)) {
    const tierPassed = tests.filter(t => t.pass).length;
    const scores = tests.map(t => t.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    console.log(`${tier}: ${tierPassed}/${tests.length} passed, avg score: ${avgScore.toFixed(3)}`);
    console.log(`  Score range: ${Math.min(...scores).toFixed(3)} - ${Math.max(...scores).toFixed(3)}`);
    
    // Show failures
    const failures = tests.filter(t => !t.pass);
    if (failures.length > 0) {
      console.log(`  Failures:`);
      for (const f of failures.slice(0, 3)) {
        console.log(`    "${f.prompt.slice(0, 40)}..." → ${f.tier} (score: ${f.score.toFixed(3)})`);
      }
    }
    console.log();
  }
  
  console.log(`=== Overall: ${passed}/${COMPREHENSIVE_TESTS.length} passed (${(passed/COMPREHENSIVE_TESTS.length*100).toFixed(1)}%) ===\n`);
  
  // Tune thresholds based on results
  console.log('=== Threshold Tuning ===\n');
  const tuning = tuneThresholds(results);
  
  console.log('Current thresholds:');
  console.log(`  simpleMedium: ${tuning.thresholds.simpleMedium.toFixed(3)}`);
  console.log(`  mediumComplex: ${tuning.thresholds.mediumComplex.toFixed(3)}`);
  console.log(`  complexReasoning: ${tuning.thresholds.complexReasoning.toFixed(3)}`);
  console.log();
  
  if (tuning.adjustments.length > 0) {
    console.log('Recommended adjustments:');
    for (const adj of tuning.adjustments) {
      console.log(`  ${adj.threshold}: ${adj.action} to ${typeof adj.value === 'number' ? adj.value.toFixed(3) : adj.value}`);
      console.log(`    Reason: ${adj.reason}`);
    }
  } else {
    console.log('No adjustments needed - thresholds are well-calibrated.');
  }
  
  // Score distribution analysis
  console.log('\n=== Score Distribution Analysis ===\n');
  
  const scoreRanges = {
    '< 0.15': results.filter(r => r.score < 0.15).length,
    '0.15-0.25': results.filter(r => r.score >= 0.15 && r.score < 0.25).length,
    '0.25-0.35': results.filter(r => r.score >= 0.25 && r.score < 0.35).length,
    '0.35-0.45': results.filter(r => r.score >= 0.35 && r.score < 0.45).length,
    '0.45-0.55': results.filter(r => r.score >= 0.45 && r.score < 0.55).length,
    '0.55-0.65': results.filter(r => r.score >= 0.55 && r.score < 0.65).length,
    '> 0.65': results.filter(r => r.score >= 0.65).length,
  };
  
  console.log('Score distribution:');
  for (const [range, count] of Object.entries(scoreRanges)) {
    const bar = '█'.repeat(Math.round(count / 2));
    console.log(`  ${range.padEnd(12)} ${bar} (${count})`);
  }
  
  return { results, passed, failed, tuning };
}

// === Interactive Tuning Mode ===

function interactiveTune() {
  console.log('\n=== Interactive Threshold Tuning ===\n');
  console.log('Current thresholds:');
  console.log(`  simpleMedium: ${THRESHOLDS.simpleMedium.toFixed(3)}`);
  console.log(`  mediumComplex: ${THRESHOLDS.mediumComplex.toFixed(3)}`);
  console.log(`  complexReasoning: ${THRESHOLDS.complexReasoning.toFixed(3)}`);
  console.log();
  console.log('Usage:');
  console.log('  node tune-thresholds.js set <threshold> <value>');
  console.log('  node tune-thresholds.js reset');
  console.log('  node tune-thresholds.js analyze');
}

// === CLI ===

const args = process.argv.slice(2);

if (args[0] === 'set' && args[1] && args[2]) {
  const threshold = args[1];
  const value = parseFloat(args[2]);
  if (THRESHOLDS[threshold] !== undefined && !isNaN(value)) {
    THRESHOLDS[threshold] = value;
    console.log(`Set ${threshold} to ${value.toFixed(3)}`);
    console.log('Updated thresholds:', THRESHOLDS);
  } else {
    console.log('Invalid threshold or value');
    console.log('Valid thresholds:', Object.keys(THRESHOLDS).join(', '));
  }
} else if (args[0] === 'reset') {
  THRESHOLDS = {
    simpleMedium: 0.20,
    mediumComplex: 0.40,
    complexReasoning: 0.60,
    reasoningKeywordCount: 2,
  };
  console.log('Reset thresholds to defaults:', THRESHOLDS);
} else {
  runComprehensiveTests();
}

module.exports = {
  THRESHOLDS,
  tuneThresholds,
  logUsage,
  getUsageStats,
  calculateSavings,
  runComprehensiveTests,
};