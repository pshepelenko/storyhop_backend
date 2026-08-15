import { Global, Module } from '@nestjs/common';
import { PromptsModule } from '../prompts/prompts.module';
import { OpenRouterService } from './openrouter.service';

@Global()
@Module({
  imports: [PromptsModule],
  providers: [OpenRouterService],
  exports: [OpenRouterService],
})
export class OpenRouterModule {}
