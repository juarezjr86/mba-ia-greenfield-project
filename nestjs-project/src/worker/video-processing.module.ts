import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import videosConfig from '../config/videos.config';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from '../videos/entities/video.entity';
import { VideoProcessingService } from './video-processing.service';
import { VideoProcessor } from './video.processor';

/**
 * The queue consumer. A non-root module: no `ConfigModule.forRoot`, no
 * `TypeOrmModule.forRoot` and no controller, so the worker root module can
 * import it. It is NOT imported by `AppModule`: a `@Processor` provider starts
 * a BullMQ Worker in whichever process loads it, and the API must not consume
 * jobs.
 */
@Module({
  imports: [
    ConfigModule.forFeature(videosConfig),
    TypeOrmModule.forFeature([Video]),
    StorageModule,
    MediaModule,
    QueueModule,
  ],
  providers: [VideoProcessor, VideoProcessingService],
})
export class VideoProcessingModule {}
