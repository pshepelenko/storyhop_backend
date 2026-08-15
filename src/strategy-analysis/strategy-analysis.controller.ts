import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { StrategyAnalysisService } from './strategy-analysis.service';

@Controller('strategy-analysis')
export class StrategyAnalysisController {
  constructor(private readonly analysisService: StrategyAnalysisService) {}

  @Post('query')
  async handleQuery(@Body() body: { userId: string; query: string }): Promise<any> {
    const { userId, query } = body;

    if (!userId) {
      throw new BadRequestException('UserId is required');
    }
    if (!query) {
      throw new BadRequestException('Query is required');
    }

    console.log(`Received query from user ${userId}: ${query}`);
    return await this.analysisService.processQuery(userId, query);
  }
}
