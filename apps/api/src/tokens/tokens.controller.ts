import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { TokensService } from './tokens.service';

@Controller('tokens')
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Get()
  @UseGuards(AuthGuard)
  listTokens(@Req() request: AuthenticatedRequest) {
    return this.tokensService.listTokens(this.requireUser(request));
  }

  @Post()
  @UseGuards(AuthGuard)
  createToken(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.tokensService.createToken(this.requireUser(request), this.toRecord(body));
  }

  @Post(':id/disable')
  @UseGuards(AuthGuard)
  disableToken(@Req() request: AuthenticatedRequest, @Param('id') tokenId: string) {
    return this.tokensService.disableToken(this.requireUser(request), tokenId);
  }

  @Post(':id/reset')
  @UseGuards(AuthGuard)
  resetToken(@Req() request: AuthenticatedRequest, @Param('id') tokenId: string) {
    return this.tokensService.resetToken(this.requireUser(request), tokenId);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  deleteToken(@Req() request: AuthenticatedRequest, @Param('id') tokenId: string) {
    return this.tokensService.deleteToken(this.requireUser(request), tokenId);
  }

  @Get('verify')
  verifyApiToken(@Req() request: AuthenticatedRequest) {
    return this.tokensService.verifyApiToken(this.getBearerApiKey(request.headers.authorization));
  }

  private requireUser(request: AuthenticatedRequest) {
    if (!request.auth?.user) {
      throw new BadRequestException('认证上下文缺失');
    }

    return request.auth.user;
  }

  private getBearerApiKey(authorization?: string) {
    if (!authorization) {
      throw new UnauthorizedException('缺少 API Key');
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('API Key 格式错误');
    }

    return token;
  }

  private toRecord(value: unknown) {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }
}
