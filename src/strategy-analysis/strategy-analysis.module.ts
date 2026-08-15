import { Module } from '@nestjs/common';
import { StrategyAnalysisController } from './strategy-analysis.controller';
import { StrategyAnalysisService } from './strategy-analysis.service';

@Module({
  controllers: [StrategyAnalysisController],
  providers: [StrategyAnalysisService],
})
export class StrategyAnalysisModule {}
