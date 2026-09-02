import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'child_process';

const ffmpegPath = require('ffmpeg-static') as string | null;
const MAX_OUTPUT_BYTES = 256 * 1024;
const NORMALIZATION_TIMEOUT_MS = 5000;

@Injectable()
export class SpeakingAudioNormalizerService {
  async toMp3(input: Buffer): Promise<Buffer> {
    if (!ffmpegPath) {
      throw new ServiceUnavailableException('Speech audio normalization is unavailable');
    }

    return new Promise<Buffer>((resolve, reject) => {
      const process = spawn(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        '-nostdin',
        '-i', 'pipe:0',
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-c:a', 'libmp3lame',
        '-b:a', '64k',
        '-f', 'mp3',
        'pipe:1',
      ]);
      const output: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputSize = 0;
      let settled = false;

      const finish = (error?: Error, audio?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(audio as Buffer);
      };
      const timeout = setTimeout(() => {
        process.kill('SIGKILL');
        finish(new Error('Speaking audio normalization timed out'));
      }, NORMALIZATION_TIMEOUT_MS);

      process.stdout.on('data', (chunk: Buffer) => {
        outputSize += chunk.length;
        if (outputSize > MAX_OUTPUT_BYTES) {
          process.kill('SIGKILL');
          finish(new Error('Normalized speaking audio is too large'));
          return;
        }
        output.push(chunk);
      });
      process.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      process.on('error', (error) => finish(error));
      process.on('close', (code) => {
        const normalized = Buffer.concat(output);
        if (code !== 0 || !normalized.length) {
          const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 240);
          finish(new Error(`Speaking audio normalization failed${detail ? `: ${detail}` : ''}`));
          return;
        }
        finish(undefined, normalized);
      });
      process.stdin.end(input);
    });
  }

  describeContainer(input: Buffer) {
    return input.subarray(0, 12).toString('hex');
  }
}
