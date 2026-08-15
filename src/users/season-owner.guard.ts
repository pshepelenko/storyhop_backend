import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Season } from '../seasons/entities/season.entity';

@Injectable()
export class SeasonOwnerGuard implements CanActivate {
  constructor(@InjectRepository(Season) private readonly seasonsRepository: Repository<Season>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const seasonId = request.params?.seasonId;
    if (!seasonId) return true;
    const season = await this.seasonsRepository.findOne({ where: { seasonId, ownerUserId: request.authUser.userId } });
    if (!season) throw new NotFoundException('Season not found');
    request.season = season;
    return true;
  }
}
