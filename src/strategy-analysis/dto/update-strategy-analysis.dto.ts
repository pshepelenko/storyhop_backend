import { PartialType } from '@nestjs/mapped-types';
import { CreateStrategyAnalysisDto } from './create-strategy-analysis.dto';

export class UpdateStrategyAnalysisDto extends PartialType(CreateStrategyAnalysisDto) {}
