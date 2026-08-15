import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageProxyController } from './storage-proxy.controller';

@Global()
@Module({
  providers: [StorageService],
  controllers: [StorageProxyController],
  exports: [StorageService],
})
export class StorageModule {}
