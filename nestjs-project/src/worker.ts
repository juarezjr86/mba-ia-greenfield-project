import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { VIDEO_PROCESSING_QUEUE } from './queue/queue.constants';
import { WorkerModule } from './worker/worker.module';

/**
 * Entrypoint of the `video-worker` process. An application context, not an HTTP
 * server: it only runs the BullMQ consumer. On SIGTERM/SIGINT Nest closes the
 * module and `@nestjs/bullmq` closes the Worker, which lets the active job end.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('VideoWorker').log(
    `Video worker listening on queue ${VIDEO_PROCESSING_QUEUE}`,
  );
}

void bootstrap();
