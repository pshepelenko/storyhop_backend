import { Injectable } from '@nestjs/common';

export type NormalizedMp3 = {
  buffer: Buffer;
  durationSeconds: number;
  frameCount: number;
  changed: boolean;
};

type Mp3Frame = {
  offset: number;
  length: number;
  samples: number;
  sampleRate: number;
  xingOffset: number;
};

/**
 * OpenRouter's MP3 output can contain an incomplete Xing frame/byte count.
 * Safari trusts that header, so repair it deterministically before storing the
 * file. This is CPU-only and runs inside the existing worker before its one
 * R2 upload.
 */
@Injectable()
export class AudioMetadataService {
  normalizeMp3(buffer: Buffer): NormalizedMp3 {
    const first = this.findFirstFrame(buffer);
    if (!first) {
      throw new Error('TTS response is not a readable MP3 stream');
    }

    const frames: Mp3Frame[] = [];
    let offset = first.offset;
    while (offset + 4 <= buffer.length) {
      const frame = this.parseFrame(buffer, offset);
      if (!frame || offset + frame.length > buffer.length) break;
      frames.push(frame);
      offset += frame.length;
    }
    if (!frames.length) {
      throw new Error('TTS response contains no complete MP3 frames');
    }

    const durationSeconds = frames.reduce((sum, frame) => sum + frame.samples / frame.sampleRate, 0);
    const normalized = Buffer.from(buffer);
    const firstFrame = frames[0];
    const marker = normalized.toString('ascii', firstFrame.xingOffset, firstFrame.xingOffset + 4);
    let changed = false;

    if (marker === 'Xing' || marker === 'Info') {
      const flags = normalized.readUInt32BE(firstFrame.xingOffset + 4);
      let cursor = firstFrame.xingOffset + 8;
      if (flags & 0x1) {
        if (normalized.readUInt32BE(cursor) !== frames.length) {
          normalized.writeUInt32BE(frames.length, cursor);
          changed = true;
        }
        cursor += 4;
      }
      if (flags & 0x2 && normalized.readUInt32BE(cursor) !== buffer.length) {
        normalized.writeUInt32BE(buffer.length, cursor);
        changed = true;
      }
    }

    return { buffer: normalized, durationSeconds, frameCount: frames.length, changed };
  }

  private findFirstFrame(buffer: Buffer): Mp3Frame | null {
    for (let offset = 0; offset + 4 <= buffer.length; offset += 1) {
      const frame = this.parseFrame(buffer, offset);
      if (frame) return frame;
    }
    return null;
  }

  private parseFrame(buffer: Buffer, offset: number): Mp3Frame | null {
    const header = buffer.readUInt32BE(offset);
    if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return null;
    const versionBits = (header >>> 19) & 0x3;
    const layerBits = (header >>> 17) & 0x3;
    const bitrateIndex = (header >>> 12) & 0xf;
    const sampleRateIndex = (header >>> 10) & 0x3;
    if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      return null;
    }

    const mpeg1 = versionBits === 3;
    const baseSampleRates = [44100, 48000, 32000];
    const sampleRate = baseSampleRates[sampleRateIndex] / (mpeg1 ? 1 : versionBits === 2 ? 2 : 4);
    const bitrateKbps = (mpeg1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex];
    const padding = (header >>> 9) & 0x1;
    const length = Math.floor((mpeg1 ? 144 : 72) * bitrateKbps * 1000 / sampleRate) + padding;
    if (!length) return null;
    const protectedByCrc = ((header >>> 16) & 0x1) === 0;
    const mono = ((header >>> 6) & 0x3) === 3;
    const sideInfoLength = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    return {
      offset,
      length,
      samples: mpeg1 ? 1152 : 576,
      sampleRate,
      xingOffset: offset + 4 + (protectedByCrc ? 2 : 0) + sideInfoLength,
    };
  }
}
