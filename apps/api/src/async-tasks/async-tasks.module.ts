import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { AsyncTasksController } from './async-tasks.controller';
import { AsyncTasksService } from './async-tasks.service';

@Module({
  imports: [AuthModule],
  controllers: [AsyncTasksController],
  providers: [AsyncTasksService, PrismaService]
})
export class AsyncTasksModule {}
