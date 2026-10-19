import {
  classifyToolFailure,
  MediaToolError,
  redactToolOutput,
  UnsupportedMediaError,
} from './media.errors';
import { thumbnailOffsetSeconds } from './media-tools.service';
import { mapProbe, type RawProbe } from './probe-mapper';

const videoProbe = (overrides: Partial<RawProbe> = {}): RawProbe => ({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '3.000000',
    bit_rate: '812345',
  },
  streams: [
    { codec_type: 'audio', codec_name: 'aac' },
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1280,
      height: 720,
      avg_frame_rate: '25/1',
    },
  ],
  ...overrides,
});

describe('mapProbe', () => {
  it('maps the format and the first video stream', () => {
    const result = mapProbe(videoProbe());

    expect(result).toMatchObject({
      duration_seconds: 3,
      container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
      video_codec: 'h264',
      width: 1280,
      height: 720,
      bitrate: 812345,
      fps: 25,
    });
  });

  it('keeps the raw ffprobe JSON', () => {
    const raw = videoProbe();

    expect(mapProbe(raw).ffprobe_metadata).toBe(raw);
  });

  it('computes fps from a fraction, rounded to three decimals', () => {
    const raw = videoProbe();
    raw.streams![1].avg_frame_rate = '30000/1001';

    expect(mapProbe(raw).fps).toBe(29.97);
  });

  it.each(['0/0', '0/1', 'abc', undefined])(
    'leaves fps null for an unknown frame rate (%s)',
    (fraction) => {
      const raw = videoProbe();
      raw.streams![1].avg_frame_rate = fraction;

      expect(mapProbe(raw).fps).toBeNull();
    },
  );

  it('leaves the bitrate null when the container does not report one', () => {
    const raw = videoProbe();
    delete raw.format!.bit_rate;

    expect(mapProbe(raw).bitrate).toBeNull();
  });

  it('falls back to the stream duration when the format has none', () => {
    const raw = videoProbe();
    delete raw.format!.duration;
    raw.streams![1].duration = '2.5';

    expect(mapProbe(raw).duration_seconds).toBe(2.5);
  });

  it('rejects an audio-only file as unsupported media', () => {
    const raw = videoProbe({ streams: [{ codec_type: 'audio' }] });

    expect(() => mapProbe(raw)).toThrow(UnsupportedMediaError);
  });

  it.each(['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm'])(
    'accepts the container %s',
    (formatName) => {
      const raw = videoProbe();
      raw.format!.format_name = formatName;

      expect(mapProbe(raw).container_format).toBe(formatName);
    },
  );

  it.each(['bin', 'tty', 'h263', 'avi', 'mpegts', 'mp3', 'mp4x', ''])(
    'rejects the container "%s" even when it has a video stream',
    (formatName) => {
      const raw = videoProbe();
      raw.format!.format_name = formatName;

      expect(() => mapProbe(raw)).toThrow(UnsupportedMediaError);
      expect(() => mapProbe(raw)).toThrow(/Unsupported container format/);
    },
  );

  it('rejects a probe without a format name', () => {
    const raw = videoProbe();
    delete raw.format!.format_name;

    expect(() => mapProbe(raw)).toThrow(
      'Unsupported container format: unknown',
    );
  });

  it('rejects a probe without streams as unsupported media', () => {
    const raw = videoProbe({ streams: [] });

    expect(() => mapProbe(raw)).toThrow('The file has no video stream');
  });

  it('rejects a probe with neither format name nor streams', () => {
    expect(() => mapProbe({ format: { duration: '1' } })).toThrow(
      UnsupportedMediaError,
    );
  });
});

describe('thumbnailOffsetSeconds', () => {
  it.each([
    [1500, 150],
    [30, 3],
    [10, 1],
    [5, 1],
    [1, 1],
  ])('takes %s s of video at %s s', (duration, offset) => {
    expect(thumbnailOffsetSeconds(duration)).toBe(offset);
  });

  it.each([0.5, 0, NaN])('clamps to 0 for a duration of %s', (duration) => {
    expect(thumbnailOffsetSeconds(duration)).toBe(0);
  });
});

describe('redactToolOutput', () => {
  const signedUrl =
    'http://storage:9000/bucket/videos/1/original.mp4?X-Amz-Credential=key%2F2026&X-Amz-Signature=abc123';

  it('replaces the input and any other URL in the tool output', () => {
    const stderr = `${signedUrl}: Server returned 404 Not Found\nRedirect to https://other.example/x?token=secret`;

    const result = redactToolOutput(stderr, signedUrl);

    expect(result).toBe(
      '[input]: Server returned 404 Not Found\nRedirect to [url]',
    );
    expect(result).not.toContain('X-Amz-');
  });

  it('replaces a local path used as input', () => {
    expect(
      redactToolOutput('/tmp/x/file.mp4: Invalid data', '/tmp/x/file.mp4'),
    ).toBe('[input]: Invalid data');
  });
});

describe('classifyToolFailure', () => {
  it.each([
    'Invalid data found when processing input',
    'moov atom not found',
    'Could not find codec parameters for stream 0',
  ])('treats "%s" as unsupported media', (stderr) => {
    expect(classifyToolFailure('ffprobe', 1, stderr)).toBeInstanceOf(
      UnsupportedMediaError,
    );
  });

  it.each([
    'Server returned 404 Not Found',
    'Connection refused',
    '',
    'something nobody has seen before',
  ])('treats "%s" as a retryable tool error', (stderr) => {
    expect(classifyToolFailure('ffprobe', 1, stderr)).toBeInstanceOf(
      MediaToolError,
    );
  });
});
