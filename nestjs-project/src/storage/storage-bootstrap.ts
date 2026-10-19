import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
    StorageModule,
  ],
})
class StorageBootstrapModule {}

/** Creates the bucket and applies its CORS rules. Idempotent. */
export async function initStorage(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    StorageBootstrapModule,
    { logger: ['error', 'warn'] },
  );
  try {
    await app.get(StorageService).ensureBucket();
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  initStorage().then(
    () => console.log('Storage bucket and CORS are ready'),
    (err: unknown) => {
      console.error('Storage init failed:', err);
      process.exitCode = 1;
    },
  );
}
