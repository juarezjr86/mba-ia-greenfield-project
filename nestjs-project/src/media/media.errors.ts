/**
 * The media itself is corrupt or unsupported. Running the tool again on the
 * same bytes gives the same answer, so the job must not be retried.
 */
export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMediaError';
  }
}

/**
 * The tool could not do its job for a reason outside the media: timeout, spawn
 * failure, read error. Retrying may succeed.
 */
export class MediaToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaToolError';
  }
}

// Messages ffprobe and ffmpeg print for content they cannot decode, recorded
// from the real tools (see media-tools.service.integration-spec.ts).
const UNSUPPORTED_MEDIA_PATTERNS: RegExp[] = [
  /Invalid data found when processing input/i,
  /moov atom not found/i,
  /Could not find codec parameters/i,
  /Unsupported codec/i,
];

/**
 * Removes the tool input from its own output. The input is a presigned URL
 * (credential and signature in the query string) or a local path; the message
 * ends up in `failure_reason`, which is stored and shown to the video owner.
 */
export function redactToolOutput(text: string, input: string): string {
  return text
    .split(input)
    .join('[input]')
    .replace(/https?:\/\/\S+/gi, '[url]');
}

/** Maps a non-zero exit to the error the retry policy understands. */
export function classifyToolFailure(
  tool: string,
  exitCode: number | null,
  stderr: string,
): UnsupportedMediaError | MediaToolError {
  const detail = stderr.trim() || 'no output on stderr';
  if (UNSUPPORTED_MEDIA_PATTERNS.some((pattern) => pattern.test(stderr))) {
    return new UnsupportedMediaError(`${tool}: ${detail}`);
  }
  // An unrecognized failure is retryable: the retry policy ends it if it persists.
  return new MediaToolError(`${tool} exited with code ${exitCode}: ${detail}`);
}
