import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ModelCatalogService } from '../model-catalog.service';
import { PrismaService } from '../prisma.service';
import { RelayService } from '../relay/relay.service';
import { TokensService } from '../tokens/tokens.service';

type ExperienceChatInput = {
  user: AuthenticatedUser;
  body: unknown;
  clientIp: string | null;
};

type ExperienceRole = 'system' | 'user' | 'assistant';

type ExperienceMessage = {
  role: ExperienceRole;
  content: string;
};

type NormalizedExperienceBody = {
  model: string;
  messages: ExperienceMessage[];
  maxTokens: number;
  temperature: number;
};

const MAX_MESSAGES = 16;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_TOTAL_MESSAGE_LENGTH = 12_000;
const DEFAULT_MAX_TOKENS = 1024;
const MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

@Injectable()
export class ExperienceService {
  constructor(
    @Inject(ModelCatalogService) private readonly modelCatalogService: ModelCatalogService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RelayService) private readonly relayService: RelayService,
    @Inject(TokensService) private readonly tokensService: TokensService
  ) {}

  async listModels(user: AuthenticatedUser, language?: string | null) {
    const models = await this.modelCatalogService.listAvailableModelsForGroup(user.group.id, language);

    return {
      items: models.map((model) => ({
        model: model.model,
        displayName: model.displayName,
        inputPriceCentsPer1k: model.inputPriceCentsPer1k,
        outputPriceCentsPer1k: model.outputPriceCentsPer1k,
        modelMultiplier: model.modelMultiplier,
        groupMultiplier: model.groupMultiplier,
        supportsStream: model.supportsStream
      }))
    };
  }

  async chat(input: ExperienceChatInput) {
    const requestId = this.relayService.createRequestId();
    const body = this.normalizeBody(input.body);

    try {
      const experienceToken = await this.tokensService.getOrCreateExperienceApiKey(input.user);
      const relayResult = await this.relayService.createChatCompletion({
        apiKey: experienceToken.apiKey,
        body: {
          model: body.model,
          messages: body.messages,
          stream: false,
          max_tokens: body.maxTokens,
          temperature: body.temperature
        },
        requestId,
        clientIp: input.clientIp,
        acceptHeader: 'application/json',
        logPath: '/experience/chat'
      });

      if (relayResult.stream) {
        throw this.relayService.createError(500, 'internal_error', 'server_error', 'Experience chat cannot stream');
      }

      const usageEventId = relayResult.headers['x-usage-event-id'] ?? null;
      const usageEvent = usageEventId
        ? await this.prisma.usageEvent.findUnique({
            where: { id: usageEventId },
            include: { walletTransaction: true }
          })
        : null;

      return {
        requestId,
        model: body.model,
        message: this.extractAssistantMessage(relayResult.body),
        raw: relayResult.body,
        usage: this.extractUsage(relayResult.body),
        billing: {
          usageEventId,
          costCents: usageEvent?.costCents ?? 0,
          status: usageEvent?.status.toLowerCase() ?? 'unknown',
          walletTransactionId: usageEvent?.walletTransaction?.id ?? null,
          balanceAfterCents: usageEvent?.walletTransaction?.balanceAfterCents ?? null
        },
        token: {
          id: experienceToken.token.id,
          name: experienceToken.token.name,
          keyPreview: experienceToken.token.keyPreview
        }
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const relayError = this.relayService.normalizeError(error);
      throw new HttpException(
        {
          message: relayError.message,
          code: relayError.code,
          requestId
        },
        relayError.status
      );
    }
  }

  private normalizeBody(value: unknown): NormalizedExperienceBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Request body must be a JSON object');
    }

    const body = value as Record<string, unknown>;
    const model = this.requiredText(body.model, 'model', 2, 120);
    const systemPrompt = this.optionalText(body.systemPrompt, 'systemPrompt', 1, 1_000);
    const messages = this.normalizeMessages(body.messages, body.message);
    const withSystemPrompt = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }, ...messages] : messages;
    const totalLength = withSystemPrompt.reduce((sum, message) => sum + message.content.length, 0);

    if (withSystemPrompt.length > MAX_MESSAGES) {
      throw new BadRequestException(`At most ${MAX_MESSAGES} messages are allowed`);
    }

    if (totalLength > MAX_TOTAL_MESSAGE_LENGTH) {
      throw new BadRequestException(`Message content cannot exceed ${MAX_TOTAL_MESSAGE_LENGTH} characters`);
    }

    return {
      model,
      messages: withSystemPrompt,
      maxTokens: this.optionalInteger(body.maxTokens, DEFAULT_MAX_TOKENS, 1, MAX_OUTPUT_TOKENS, 'maxTokens'),
      temperature: this.optionalNumber(body.temperature, DEFAULT_TEMPERATURE, 0, 2, 'temperature')
    };
  }

  private normalizeMessages(value: unknown, fallbackMessage: unknown): ExperienceMessage[] {
    const rawMessages =
      Array.isArray(value) && value.length > 0
        ? value
        : typeof fallbackMessage === 'string' && fallbackMessage.trim()
          ? [{ role: 'user', content: fallbackMessage }]
          : null;

    if (!rawMessages) {
      throw new BadRequestException('Message content is required');
    }

    const messages = rawMessages.map((entry, index) => this.normalizeMessage(entry, index));
    if (messages[messages.length - 1]?.role !== 'user') {
      throw new BadRequestException('The last message must be a user message');
    }

    return messages;
  }

  private normalizeMessage(value: unknown, index: number): ExperienceMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`Message ${index + 1} must be an object`);
    }

    const message = value as Record<string, unknown>;
    const role = message.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new BadRequestException(`Message ${index + 1} has an invalid role`);
    }

    const content = this.requiredText(message.content, `message ${index + 1}`, 1, MAX_MESSAGE_LENGTH);
    return { role, content };
  }

  private requiredText(value: unknown, fieldName: string, minLength: number, maxLength: number) {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} must be text`);
    }

    const text = value.trim();
    if (text.length < minLength || text.length > maxLength) {
      throw new BadRequestException(`${fieldName} length must be between ${minLength} and ${maxLength} characters`);
    }

    return text;
  }

  private optionalText(value: unknown, fieldName: string, minLength: number, maxLength: number) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return this.requiredText(value, fieldName, minLength, maxLength);
  }

  private optionalInteger(value: unknown, fallback: number, min: number, max: number, fieldName: string) {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
      throw new BadRequestException(`${fieldName} must be an integer between ${min} and ${max}`);
    }

    return numericValue;
  }

  private optionalNumber(value: unknown, fallback: number, min: number, max: number, fieldName: string) {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(numericValue) || numericValue < min || numericValue > max) {
      throw new BadRequestException(`${fieldName} must be a number between ${min} and ${max}`);
    }

    return numericValue;
  }

  private extractAssistantMessage(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return '';
    }

    const choices = (body as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return '';
    }

    const firstChoice = choices[0];
    if (!firstChoice || typeof firstChoice !== 'object' || Array.isArray(firstChoice)) {
      return '';
    }

    const message = (firstChoice as { message?: unknown; text?: unknown }).message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      return this.extractContent((message as { content?: unknown }).content);
    }

    return this.extractContent((firstChoice as { text?: unknown }).text);
  }

  private extractContent(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          if (part && typeof part === 'object' && !Array.isArray(part)) {
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }

    return '';
  }

  private extractUsage(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
    }

    const usage = (body as { usage?: unknown }).usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
      return {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
    }

    const usageRecord = usage as Record<string, unknown>;
    const promptTokens = this.nonNegativeInteger(usageRecord.prompt_tokens ?? usageRecord.input_tokens);
    const completionTokens = this.nonNegativeInteger(usageRecord.completion_tokens ?? usageRecord.output_tokens);
    const totalTokens = this.nonNegativeInteger(usageRecord.total_tokens);

    return {
      promptTokens,
      completionTokens,
      totalTokens: totalTokens || promptTokens + completionTokens
    };
  }

  private nonNegativeInteger(value: unknown) {
    return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  }
}
