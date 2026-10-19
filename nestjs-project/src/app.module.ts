import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { rootConfigModule, rootDatabaseModule } from './config/root-modules';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [rootConfigModule, rootDatabaseModule, AuthModule, VideosModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
