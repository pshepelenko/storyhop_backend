import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmGenerationDiagnostic } from './entities/llm-generation-diagnostic.entity';
import { LlmDiagnosticsService } from './llm-diagnostics.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([LlmGenerationDiagnostic])],
  providers: [LlmDiagnosticsService],
  exports: [LlmDiagnosticsService],
})
export class LlmDiagnosticsModule {}
