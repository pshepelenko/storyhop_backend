import { Global, Module } from '@nestjs/common';
import { PixazoService } from './pixazo.service';

@Global()
@Module({
  providers: [PixazoService],
  exports: [PixazoService],
})
export class PixazoModule {}
