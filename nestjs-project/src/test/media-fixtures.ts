import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GenerateMp4Options {
  durationSeconds: number;
  width?: number;
  height?: number;
  /** Target video bitrate in Mb/s; noise content makes the file really that big. */
  megabitsPerSecond?: number;
}

/**
 * Generates an H.264 MP4 with `ffmpeg -f lavfi`, so no binary fixture is
 * committed. It is written without `+faststart`: the `moov` atom sits at the
 * end of the file, the layout that makes a tool read the tail by `Range`.
 */
export async function generateMp4(
  outputPath: string,
  options: GenerateMp4Options,
): Promise<void> {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const size = `${width}x${height}`;
  const bitrate = options.megabitsPerSecond;

  // Plain test pattern for small files; random noise for big ones, since
  // noise does not compress and the bitrate target is reached.
  const source =
    bitrate === undefined
      ? `testsrc2=size=${size}:rate=25`
      : `nullsrc=size=${size}:rate=25,geq=random(1)*255:128:128`;
  const rateArgs =
    bitrate === undefined
      ? []
      : [
          '-b:v',
          `${bitrate}M`,
          '-minrate',
          `${bitrate}M`,
          '-maxrate',
          `${bitrate}M`,
          '-bufsize',
          `${bitrate * 2}M`,
        ];

  await execFileAsync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    source,
    '-t',
    String(options.durationSeconds),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    // A keyframe every 2 seconds, as players and encoders usually produce.
    '-g',
    '50',
    ...rateArgs,
    '-an',
    outputPath,
  ]);
}

/** Width and height of a JPEG, read from its first start-of-frame marker. */
export function jpegSize(image: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < image.length) {
    if (image[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = image[offset + 1];
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      return {
        height: image.readUInt16BE(offset + 5),
        width: image.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + image.readUInt16BE(offset + 2);
  }
  throw new Error('No start-of-frame marker found: not a JPEG');
}

/**
 * Bytes that are not a video, the same on every run. Random bytes are not safe
 * for this: `ffprobe` reads about 1 in 300 random 200 KB files named `.mp4` as
 * a raw `h263` stream (measured on ffprobe 5.1), so a test using them failed
 * once in a while. A zero-filled buffer ends `Invalid data found when
 * processing input` for the `.mp4` storage keys the specs use.
 */
export function notAVideo(sizeBytes = 200 * 1024): Buffer {
  return Buffer.alloc(sizeBytes);
}
