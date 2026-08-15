import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { StorageService } from './storage.service';

@Controller('storage-proxy')
export class StorageProxyController {
  constructor(private readonly storage: StorageService) {}

  @Get()
  async proxy(@Query('key') key: string, @Query('url') url: string, @Res() res: Response) {
    const storageKey = key || (url ? this.storage.extractKeyFromUrl(url) : null);
    if (!storageKey) {
      return res.status(400).json({ error: 'Missing or invalid storage key' });
    }

    try {
      const { body, contentType } = await this.storage.download(storageKey);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', body.length);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(body);
    } catch (error) {
      res.status(404).json({ error: 'File not found or access denied' });
    }
  }
}
