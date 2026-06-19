import assert from 'node:assert/strict';

import {
  canStartUsageWithEstimatedCost,
  estimateChatCompletionCostCents,
} from '../src/billing/balance-guard';

const model = {
  model: 'gpt5.5',
  inputPriceCentsPer1k: 1000,
  outputPriceCentsPer1k: 1000,
  modelMultiplier: '5',
  groupMultiplier: '1',
};

const body = {
  model: 'gpt5.5',
  stream: true,
  max_tokens: 128,
  messages: [
    {
      role: 'system',
      content: 'You are routed through a paid relay. '.repeat(20),
    },
    {
      role: 'user',
      content: 'hello',
    },
  ],
};

const estimatedCost = estimateChatCompletionCostCents(body, model);

assert.ok(
  estimatedCost > 243,
  `expected the guard estimate to exceed the low wallet balance, got ${estimatedCost}`,
);
assert.equal(canStartUsageWithEstimatedCost(243, estimatedCost), false);
assert.equal(canStartUsageWithEstimatedCost(estimatedCost, estimatedCost), true);

console.log('t25 stream billing guard qa passed');
