import { Test, TestingModule } from '@nestjs/testing';
import { StrategyAnalysisController } from './strategy-analysis.controller';
import { StrategyAnalysisService } from './strategy-analysis.service';

describe('StrategyAnalysisController', () => {
  let controller: StrategyAnalysisController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategyAnalysisController],
      providers: [StrategyAnalysisService],
    }).compile();

    controller = module.get<StrategyAnalysisController>(StrategyAnalysisController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
