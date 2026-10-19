import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import videosConfig from '../config/videos.config';
import { MediaToolsService } from './media-tools.service';

@Module({
  imports: [ConfigModule.forFeature(videosConfig)],
  providers: [MediaToolsService],
  exports: [MediaToolsService],
})
export class MediaModule {}
