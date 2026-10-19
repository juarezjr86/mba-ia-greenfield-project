import { buildStorageKey, defaultTitle } from './video-naming.util';

const ID = '3f0a6c2e-9f43-4b0a-8d57-1a2b3c4d5e6f';

describe('defaultTitle', () => {
  it('drops the extension', () => {
    expect(defaultTitle('Aula 01.mp4')).toBe('Aula 01');
  });

  it('keeps a name without extension as it is', () => {
    expect(defaultTitle('aula')).toBe('aula');
  });

  it('keeps only the last extension of a dotted name', () => {
    expect(defaultTitle('aula.final.v2.mp4')).toBe('aula.final.v2');
  });

  it('falls back to the file name when nothing remains', () => {
    expect(defaultTitle('.mp4')).toBe('.mp4');
  });
});

describe('buildStorageKey', () => {
  it('lowercases the extension', () => {
    expect(buildStorageKey(ID, 'Aula.MP4')).toBe(`videos/${ID}/original.mp4`);
  });

  it('ends in original when the name has no extension', () => {
    expect(buildStorageKey(ID, 'aula')).toBe(`videos/${ID}/original`);
  });

  it('treats a leading-dot name as having no extension', () => {
    expect(buildStorageKey(ID, '.hidden')).toBe(`videos/${ID}/original`);
  });

  it('ignores an extension longer than 10 characters', () => {
    expect(buildStorageKey(ID, 'aula.abcdefghijk')).toBe(
      `videos/${ID}/original`,
    );
  });

  it('accepts an extension of exactly 10 characters', () => {
    expect(buildStorageKey(ID, 'aula.abcdefghij')).toBe(
      `videos/${ID}/original.abcdefghij`,
    );
  });

  it('ignores an extension with characters outside [a-z0-9]', () => {
    expect(buildStorageKey(ID, 'aula.m-p4')).toBe(`videos/${ID}/original`);
  });
});
