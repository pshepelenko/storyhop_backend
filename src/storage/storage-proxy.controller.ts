import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { StorageService } from './storage.service';

@Controller('storage-proxy')
export class StorageProxyController {
  constructor(private readonly storage: StorageService) {}

  @Get()
  async proxy(
    @Query('key') key: string,
    @Query('url') url: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const storageKey = key || (url ? this.storage.extractKeyFromUrl(url) : null);
    if (!storageKey) {
      return res.status(400).json({ error: 'Missing or invalid storage key' });
    }

    try {
      const requestedRange = range && /^bytes=\d*-\d*$/.test(range) ? range : undefined;
      const { body, contentType, contentLength, contentRange } = await this.storage.download(
        storageKey,
        requestedRange,
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', contentLength);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
        res.status(206);
      }
      res.send(body);
    } catch (error) {
      res.status(404).json({ error: 'File not found or access denied' });
    }
  }
}
