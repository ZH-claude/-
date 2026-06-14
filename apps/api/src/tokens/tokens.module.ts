import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

@Module({
  imports: [AuthModule],
  controllers: [TokensController],
  providers: [TokensService, PrismaService],
  exports: [TokensService]
})
export class TokensModule {}
