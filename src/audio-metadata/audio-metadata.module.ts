import { Global, Module } from '@nestjs/common';
import { AudioMetadataService } from './audio-metadata.service';
import { TtsMediaMaintenanceService } from './tts-media-maintenance.service';

@Global()
@Module({
  providers: [AudioMetadataService, TtsMediaMaintenanceService],
  exports: [AudioMetadataService, TtsMediaMaintenanceService],
})
export class AudioMetadataModule {}
