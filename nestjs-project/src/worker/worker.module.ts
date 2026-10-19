import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { rootConfigModule, rootDatabaseModule } from '../config/root-modules';
import { QueueModule } from '../queue/queue.module';
import { User } from '../users/entities/user.entity';
import { VideoProcessingModule } from './video-processing.module';

/**
 * Root module of the `video-worker` process: the same configuration and
 * database as the API, the queue and the consumer; no controller and no HTTP.
 *
 * `autoLoadEntities` only registers what a `forFeature` declares, and the
 * consumer declares `Video` alone. `Video` points at `Channel`, which points
 * at `User` and the token tables, so TypeORM cannot build the metadata unless
 * the whole graph is registered.
 */
@Module({
  imports: [
    rootConfigModule,
    rootDatabaseModule,
    TypeOrmModule.forFeature([User, Channel, RefreshToken, VerificationToken]),
    QueueModule,
    VideoProcessingModule,
  ],
})
export class WorkerModule {}
