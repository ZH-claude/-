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
const estimatedCostWithoutModelMultiplier = estimateChatCompletionCostCents(body, {
  ...model,
  modelMultiplier: '1',
});

assert.equal(
  estimatedCost,
  estimatedCostWithoutModelMultiplier,
  'modelMultiplier must not affect stream billing guard estimates',
);
assert.ok(
  estimatedCost > 0,
  `expected the guard estimate to be positive, got ${estimatedCost}`,
);
assert.equal(canStartUsageWithEstimatedCost(0, estimatedCost), false);
assert.equal(canStartUsageWithEstimatedCost(estimatedCost, estimatedCost), true);

console.log('t25 stream billing guard qa passed');
