export type BalanceGuardModel = {
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  groupMultiplier: string;
};

type ChatCompletionBodyLike = {
  messages?: unknown;
  max_tokens?: unknown;
  max_completion_tokens?: unknown;
  stream?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  response_format?: unknown;
};

const DEFAULT_STREAM_OUTPUT_TOKEN_RESERVE = 512;
const DEFAULT_JSON_TOKEN_DIVISOR = 2;

export function canStartUsageWithEstimatedCost(balanceCents: number, estimatedCostCents: number) {
  return Number.isFinite(balanceCents) && balanceCents >= normalizeEstimatedCostCents(estimatedCostCents);
}

export function estimateChatCompletionCostCents(body: ChatCompletionBodyLike, model: BalanceGuardModel) {
  const usage = estimateChatCompletionUsage(body);
  return calculateEstimatedCostCents(usage, model);
}

export function estimateChatCompletionUsage(body: ChatCompletionBodyLike) {
  const promptTokens = estimateValueTokens({
    messages: Array.isArray(body.messages) ? body.messages : [],
    tools: body.tools,
    tool_choice: body.tool_choice,
    response_format: body.response_format
  });
  const explicitOutputTokens = readPositiveInteger(body.max_completion_tokens) ?? readPositiveInteger(body.max_tokens);
  const completionTokens = explicitOutputTokens ?? (body.stream === true ? DEFAULT_STREAM_OUTPUT_TOKEN_RESERVE : 1);

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}

function calculateEstimatedCostCents(
  usage: { promptTokens: number; completionTokens: number },
  model: BalanceGuardModel
) {
  const multiplier = parsePositiveNumber(model.modelMultiplier) * parsePositiveNumber(model.groupMultiplier);
  const inputCost = (usage.promptTokens * model.inputPriceCentsPer1k) / 1000;
  const outputCost = (usage.completionTokens * model.outputPriceCentsPer1k) / 1000;
  const cost = Math.ceil((inputCost + outputCost) * multiplier);

  if (!Number.isSafeInteger(cost) || cost < 0) {
    throw new Error('Estimated billing cost is outside the safe integer range');
  }

  return cost;
}

function estimateValueTokens(value: unknown) {
  const serialized = JSON.stringify(value ?? '');
  if (!serialized) {
    return 0;
  }

  return Math.max(1, Math.ceil(serialized.length / DEFAULT_JSON_TOKEN_DIVISOR));
}

function readPositiveInteger(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeEstimatedCostCents(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.ceil(value);
}
