import { ReadingAlignmentService } from './reading-alignment.service';

describe('ReadingAlignmentService', () => {
  const service = new ReadingAlignmentService({} as any, {} as any, {} as any);

  it('creates complete deterministic ranges that end at the measured MP3 duration', () => {
    const alignment = service.buildEstimated(
      'Mira walks to the moonlit river. The silver boat wakes up.',
      'https://storage.example/demo.mp3',
      12,
    );

    expect(alignment.status).toBe('estimated');
    expect(alignment.estimatedRanges.length).toBeGreaterThan(0);
    expect(alignment.estimatedRanges[0].startSeconds).toBe(0);
    expect(alignment.estimatedRanges[alignment.estimatedRanges.length - 1]?.endSeconds).toBe(12);
  });

  it('keeps canonical character ranges when timestamped words contain punctuation', () => {
    const ranges = (service as any).alignWords(
      "Mira's boat is ready.",
      [
        { word: "Mira's", start: 0, end: 0.4 },
        { word: 'boat,', start: 0.4, end: 0.8 },
        { word: 'is', start: 0.8, end: 0.95 },
        { word: 'ready.', start: 0.95, end: 1.4 },
      ],
      2,
    );

    expect(ranges).toHaveLength(4);
    expect(ranges[0]).toMatchObject({ start: 0, end: 6, startSeconds: 0, endSeconds: 0.4 });
    expect(ranges[ranges.length - 1]).toMatchObject({ startSeconds: 0.95, endSeconds: 1.4 });
  });
});
