import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageModule', () => {
  it('compiles and exposes StorageService', async () => {
    const module = await Test.createTestingModule({ imports: [StorageModule] })
      .overrideProvider(storageConfig.KEY)
      .useValue({
        endpoint: 'http://storage:9000',
        publicEndpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'streamtube',
        accessKey: 'access',
        secretKey: 'secret',
        corsAllowedOrigins: '*',
      })
      .compile();

    expect(module.get(StorageService)).toBeInstanceOf(StorageService);
    await module.close();
  });
});
