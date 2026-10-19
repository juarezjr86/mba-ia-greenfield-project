import { UnsupportedMediaError } from './media.errors';

/** The subset of the `ffprobe -print_format json` output the mapper reads. */
export interface RawProbe {
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
  };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    duration?: string;
  }[];
}

/** Metadata persisted on the `videos` row (names follow its columns). */
export interface MediaMetadata {
  duration_seconds: number | null;
  container_format: string | null;
  video_codec: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  fps: number | null;
  ffprobe_metadata: RawProbe;
}

function toFiniteNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `avg_frame_rate` is a fraction such as `30000/1001`; `0/0` means unknown. */
function parseFps(fraction: string | undefined): number | null {
  if (!fraction) return null;
  const [numerator, denominator] = fraction.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0 || numerator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

/**
 * Maps the raw ffprobe JSON to the metadata fields. A file without a video
 * stream (audio only, or no stream at all) is unsupported media.
 */
export function mapProbe(raw: RawProbe): MediaMetadata {
  const video = raw.streams?.find((stream) => stream.codec_type === 'video');
  if (!video) {
    throw new UnsupportedMediaError('The file has no video stream');
  }

  const bitrate = toFiniteNumber(raw.format?.bit_rate);
  return {
    duration_seconds:
      toFiniteNumber(raw.format?.duration) ?? toFiniteNumber(video.duration),
    container_format: raw.format?.format_name ?? null,
    video_codec: video.codec_name ?? null,
    width: video.width ?? null,
    height: video.height ?? null,
    bitrate: bitrate === null ? null : Math.round(bitrate),
    fps: parseFps(video.avg_frame_rate),
    ffprobe_metadata: raw,
  };
}
