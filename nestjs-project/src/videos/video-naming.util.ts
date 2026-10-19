import { extname, parse } from 'node:path';

const SAFE_EXTENSION = /^[a-z0-9]{1,10}$/;

/** Title used when the client sends none: the file name without its extension. */
export function defaultTitle(filename: string): string {
  const name = parse(filename).name.trim();
  return name.length > 0 ? name : filename;
}

/**
 * `videos/{videoId}/original.<ext>`. The extension is the lowercase one of the
 * file name when it is 1 to 10 letters or digits; otherwise the key ends in `original`.
 */
export function buildStorageKey(videoId: string, filename: string): string {
  const extension = extname(filename).slice(1).toLowerCase();
  const suffix = SAFE_EXTENSION.test(extension) ? `.${extension}` : '';
  return `videos/${videoId}/original${suffix}`;
}
