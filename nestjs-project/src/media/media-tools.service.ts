import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videosConfig from '../config/videos.config';
import { classifyToolFailure, MediaToolError } from './media.errors';
import { mapProbe, type MediaMetadata, type RawProbe } from './probe-mapper';

const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_POSITION = 0.1;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_CHARS = 8 * 1024;

// The input comes from an uploaded file, which can be a playlist that points at
// other resources (local files, other hosts). Only the protocols needed to
// read the object itself are allowed. ffmpeg 5.1 already narrows the default
// list for a remote input; pinning it keeps that from depending on the
// version, and it is what stops a downloaded file (local input) from making
// the worker fetch URLs.
const REMOTE_PROTOCOLS = 'http,https,tcp,tls,crypto';
const LOCAL_PROTOCOLS = 'file,crypto';

interface ToolOutput {
  stdout: Buffer;
  stderr: string;
}

function protocolWhitelist(input: string): string[] {
  const remote = /^https?:\/\//i.test(input);
  return ['-protocol_whitelist', remote ? REMOTE_PROTOCOLS : LOCAL_PROTOCOLS];
}

/**
 * Seconds into the video where the thumbnail is taken: 10% of the duration,
 * at least 1 second, and 0 for a clip shorter than 1 second.
 */
export function thumbnailOffsetSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1) return 0;
  return Math.max(1, durationSeconds * THUMBNAIL_POSITION);
}

@Injectable()
export class MediaToolsService {
  constructor(
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {}

  /**
   * Reads the metadata of a video. `input` is a presigned GET URL (the tool
   * reads it with `Range` requests, no local copy) or a local file path.
   */
  async probe(input: string): Promise<MediaMetadata> {
    const { stdout } = await this.run('ffprobe', [
      '-v',
      'error',
      ...protocolWhitelist(input),
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '-i',
      input,
    ]);

    let raw: RawProbe;
    try {
      raw = JSON.parse(stdout.toString('utf8')) as RawProbe;
    } catch {
      throw new MediaToolError('ffprobe printed output that is not JSON');
    }
    return mapProbe(raw);
  }

  /** Returns one JPEG frame, 640 px wide, taken at 10% of the duration. */
  async extractThumbnail(
    input: string,
    durationSeconds: number,
  ): Promise<Buffer> {
    const outputPath = join(tmpdir(), `thumbnail-${randomUUID()}.jpg`);
    try {
      await this.run('ffmpeg', [
        '-v',
        'error',
        ...protocolWhitelist(input),
        '-ss',
        String(thumbnailOffsetSeconds(durationSeconds)),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        `scale=${THUMBNAIL_WIDTH}:-2`,
        '-y',
        outputPath,
      ]);

      let image: Buffer;
      try {
        image = await readFile(outputPath);
      } catch {
        throw new MediaToolError('ffmpeg produced no thumbnail file');
      }
      if (image.length === 0) {
        throw new MediaToolError('ffmpeg produced an empty thumbnail');
      }
      return image;
    } finally {
      await rm(outputPath, { force: true });
    }
  }

  /** Runs a tool with an argument array (no shell) and kills it on timeout. */
  private run(
    command: 'ffprobe' | 'ffmpeg',
    args: string[],
  ): Promise<ToolOutput> {
    const timeoutMs = this.config.mediaToolTimeoutMs;

    return new Promise<ToolOutput>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderr = '';
      let settled = false;

      const finish = (error: Error | null, output?: ToolOutput): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(output!);
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new MediaToolError(`${command} exceeded ${timeoutMs} ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          child.kill('SIGKILL');
          finish(new MediaToolError(`${command} printed too much output`));
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_CHARS);
      });
      child.on('error', (err) => {
        finish(
          new MediaToolError(`${command} could not start: ${err.message}`),
        );
      });
      child.on('close', (code) => {
        if (code === 0) {
          finish(null, { stdout: Buffer.concat(chunks), stderr });
        } else {
          finish(classifyToolFailure(command, code, stderr));
        }
      });
    });
  }
}
