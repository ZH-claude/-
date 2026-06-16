import { All, Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RelayService } from './relay.service';

type RelayRequest = FastifyRequest & {
  headers: {
    authorization?: string;
    accept?: string;
    'x-forwarded-for'?: string | string[];
  };
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};

@Controller('v1')
export class RelayController {
  constructor(@Inject(RelayService) private readonly relayService: RelayService) {}

  @Get('models')
  async listModels(@Req() request: RelayRequest, @Res() reply: FastifyReply) {
    const startedAt = Date.now();
    const requestId = this.relayService.createRequestId();

    try {
      const result = await this.relayService.listModels(this.getBearerApiKey(request), requestId, this.getClientIp(request));
      reply.header('x-request-id', requestId).send(result);
    } catch (error) {
      await this.sendRelayError(reply, error, requestId, {
        startedAt,
        method: 'GET',
        path: '/v1/models',
        model: null
      });
    }
  }

  @Post('chat/completions')
  async createChatCompletion(
    @Req() request: RelayRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown
  ) {
    const startedAt = Date.now();
    const requestId = this.relayService.createRequestId();

    try {
      const result = await this.relayService.createChatCompletion({
        apiKey: this.getBearerApiKey(request),
        body,
        requestId,
        clientIp: this.getClientIp(request),
        acceptHeader: request.headers.accept
      });

      if (result.stream) {
        reply.raw.writeHead(result.status, result.headers);

        try {
          await this.relayService.pipeUpstreamStream(result.upstreamResponse, reply.raw);
        } catch {
          reply.raw.end();
        }
        return;
      }

      reply.code(result.status).headers(result.headers).send(result.body);
    } catch (error) {
      await this.sendRelayError(reply, error, requestId, {
        startedAt,
        method: 'POST',
        path: '/v1/chat/completions',
        model: this.getBodyModel(body)
      });
    }
  }

  @All('*')
  async unsupported(@Req() request: RelayRequest, @Res() reply: FastifyReply) {
    const startedAt = Date.now();
    const requestId = this.relayService.createRequestId();
    await this.sendRelayError(
      reply,
      this.relayService.createError(501, 'not_implemented', 'invalid_request_error', 'This endpoint is not implemented in MVP'),
      requestId,
      {
        startedAt,
        method: request.method,
        path: request.url,
        model: null
      }
    );
  }

  private getBearerApiKey(request: RelayRequest) {
    const authorization = request.headers.authorization;
    if (!authorization) {
      throw this.relayService.createError(401, 'invalid_api_key', 'authentication_error', 'Missing API key');
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw this.relayService.createError(401, 'invalid_api_key', 'authentication_error', 'Invalid API key format');
    }

    return token;
  }

  private async sendRelayError(
    reply: FastifyReply,
    error: unknown,
    requestId: string,
    logInput: { startedAt: number; method: string; path: string; model: string | null }
  ) {
    const relayError = this.relayService.normalizeError(error);
    await this.relayService.recordRejectedRelayRequest({
      requestId,
      method: logInput.method,
      path: logInput.path,
      model: logInput.model,
      startedAt: logInput.startedAt,
      error
    });
    reply
      .code(relayError.status)
      .header('x-request-id', requestId)
      .send({
        error: {
          message: relayError.message,
          type: relayError.type,
          code: relayError.code,
          request_id: requestId
        }
      });
  }

  private getBodyModel(body: unknown) {
    return body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { model?: unknown }).model === 'string'
      ? (body as { model: string }).model
      : null;
  }

  private getClientIp(request: RelayRequest) {
    const forwardedFor = request.headers['x-forwarded-for'];
    const headerValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const candidate = headerValue?.split(',')[0]?.trim() || request.ip || request.socket?.remoteAddress || null;
    return candidate?.replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '') ?? null;
  }
}
