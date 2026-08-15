import { Test, TestingModule } from '@nestjs/testing';
import { StrategyAnalysisService } from './strategy-analysis.service';

describe('StrategyAnalysisService', () => {
  let service: StrategyAnalysisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StrategyAnalysisService],
    }).compile();

    service = module.get<StrategyAnalysisService>(StrategyAnalysisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
