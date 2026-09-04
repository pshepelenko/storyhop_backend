import { Global, Module } from '@nestjs/common';
import { ReadingAlignmentService } from './reading-alignment.service';

@Global()
@Module({
  providers: [ReadingAlignmentService],
  exports: [ReadingAlignmentService],
})
export class ReadingAlignmentModule {}
