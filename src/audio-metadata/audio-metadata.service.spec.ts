import { AudioMetadataService } from './audio-metadata.service';

describe('AudioMetadataService', () => {
  it('repairs an incomplete Xing duration without re-encoding the MP3', () => {
    const frameLength = 192;
    const frameCount = 10;
    const buffer = Buffer.alloc(frameLength * frameCount);
    // MPEG-2 Layer III, 64 kbps, 24 kHz, stereo.
    const header = 0xfff38400;
    for (let index = 0; index < frameCount; index += 1) {
      buffer.writeUInt32BE(header, index * frameLength);
    }
    const xingOffset = 4 + 17;
    buffer.write('Xing', xingOffset, 'ascii');
    buffer.writeUInt32BE(3, xingOffset + 4);
    buffer.writeUInt32BE(1, xingOffset + 8);
    buffer.writeUInt32BE(frameLength, xingOffset + 12);

    const result = new AudioMetadataService().normalizeMp3(buffer);

    expect(result.changed).toBe(true);
    expect(result.frameCount).toBe(frameCount);
    expect(result.durationSeconds).toBeCloseTo((frameCount * 576) / 24000, 6);
    expect(result.buffer.readUInt32BE(xingOffset + 8)).toBe(frameCount);
    expect(result.buffer.readUInt32BE(xingOffset + 12)).toBe(buffer.length);
  });
});
