import { SpeakingAudioNormalizerService } from './speaking-audio-normalizer.service';

function buildSilentWav(durationMs = 250) {
  const sampleRate = 16000;
  const sampleCount = Math.round((sampleRate * durationMs) / 1000);
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

describe('SpeakingAudioNormalizerService', () => {
  it('transcodes a browser-independent audio container to MP3 in memory', async () => {
    const service = new SpeakingAudioNormalizerService();

    const mp3 = await service.toMp3(buildSilentWav());

    expect(mp3.length).toBeGreaterThan(0);
    expect(mp3.subarray(0, 3).toString('ascii')).toBe('ID3');
    expect(service.describeContainer(buildSilentWav())).toBe('52494646641f000057415645');
  });
});
