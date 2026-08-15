import { Controller, Get, HttpException, HttpStatus, Param, Post } from '@nestjs/common';
import { DemoStoryService } from './demo-story.service';
import { assertMaintenanceRouteEnabled } from '../security/maintenance-route';

@Controller('demo-story')
export class DemoStoryController {
  constructor(private readonly demoStoryService: DemoStoryService) {}

  @Get()
  async getDefaultDemoStory() {
    try {
      return await this.demoStoryService.getDemoStory();
    } catch (error) {
      throw new HttpException(error?.message || 'Could not load demo story', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':slug')
  async getDemoStory(@Param('slug') slug: string) {
    try {
      return await this.demoStoryService.getDemoStory(slug);
    } catch (error) {
      throw new HttpException(error?.message || 'Could not load demo story', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('seed/text')
  async seedText() {
    assertMaintenanceRouteEnabled();
    try {
      return await this.demoStoryService.seedTextContent();
    } catch (error) {
      throw new HttpException(error?.message || 'Could not seed demo story text', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('seed/media')
  async seedMedia() {
    assertMaintenanceRouteEnabled();
    try {
      return await this.demoStoryService.seedMedia();
    } catch (error) {
      throw new HttpException(error?.message || 'Could not seed demo story media', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
