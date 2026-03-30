#!/usr/bin/env node
/**
 * Test script for smart-router plugin
 * Validates the plugin loads and classifies prompts correctly
 */

const path = require('path');

// Mock API
const mockApi = {
  logger: {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`),
  },
  on: (hookName, handler) => {
    console.log(`[MOCK] Registered hook: ${hookName}`);
    mockApi._hooks[hookName] = handler;
  },
  _hooks: {},
};

// Load the plugin
console.log('Loading smart-router plugin...');
const plugin = require('./index.js');

console.log(`Plugin loaded: ${plugin.name} v${plugin.version}`);
console.log(`Plugin ID: ${plugin.id}`);

// Register with mock API
console.log('\nRegistering plugin with mock API...');
plugin.register(mockApi, { enabled: true, logDecisions: true });

// Test prompts
const testPrompts = [
  { prompt: 'What is 2 + 2?', expected: 'SIMPLE' },
  { prompt: 'Explain how DNS works', expected: 'MEDIUM' },
  { prompt: 'Build a REST API with authentication and rate limiting', expected: 'COMPLEX' },
  { prompt: 'Prove that the square root of 2 is irrational', expected: 'REASONING' },
  { prompt: 'Analyze this screenshot and extract the text', expected: 'MULTIMODAL', event: { messages: [{ images: ['test.png'] }] } },
  { prompt: 'Review the entire codebase and identify security issues', expected: 'LONG_CONTEXT' },
];

console.log('\n=== Testing Classification ===\n');

async function runTests() {
  for (const test of testPrompts) {
    const handler = mockApi._hooks['before_model_resolve'];
    if (!handler) {
      console.error('ERROR: before_model_resolve hook not registered');
      process.exit(1);
    }
    
    const event = { prompt: test.prompt, ...(test.event || {}) };
    const ctx = {};
    
    const result = await handler(event, ctx);
    
    const modelOverride = result?.modelOverride || 'no-override';
    const providerOverride = result?.providerOverride;
    
    console.log(`Prompt: "${test.prompt.substring(0, 50)}..."`);
    console.log(`  Expected tier: ${test.expected}`);
    console.log(`  Routed to: ${providerOverride ? `${providerOverride}/` : ''}${modelOverride}`);
    console.log('');
  }
}

runTests().then(() => {
  console.log('=== Tests Complete ===');
});