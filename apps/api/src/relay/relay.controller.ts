import { All, Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RelayService } from './relay.service';

type RelayRequest = FastifyRequest & {
  headers: {
    authorization?: string;
    accept?: string;
  };
};

@Controller('v1')
export class RelayController {
  constructor(private readonly relayService: RelayService) {}

  @Get('models')
  async listModels(@Req() request: RelayRequest, @Res() reply: FastifyReply) {
    const requestId = this.relayService.createRequestId();

    try {
      const result = await this.relayService.listModels(this.getBearerApiKey(request), requestId);
      reply.header('x-request-id', requestId).send(result);
    } catch (error) {
      this.sendRelayError(reply, error, requestId);
    }
  }

  @Post('chat/completions')
  async createChatCompletion(
    @Req() request: RelayRequest,
    @Res() reply: FastifyReply,
    @Body() body: unknown
  ) {
    const requestId = this.relayService.createRequestId();

    try {
      const result = await this.relayService.createChatCompletion({
        apiKey: this.getBearerApiKey(request),
        body,
        requestId,
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
      this.sendRelayError(reply, error, requestId);
    }
  }

  @All('*')
  unsupported(@Res() reply: FastifyReply) {
    const requestId = this.relayService.createRequestId();
    this.sendRelayError(reply, this.relayService.createError(501, 'not_implemented', 'invalid_request_error', 'This endpoint is not implemented in MVP'), requestId);
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

  private sendRelayError(reply: FastifyReply, error: unknown, requestId: string) {
    const relayError = this.relayService.normalizeError(error);
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
}
