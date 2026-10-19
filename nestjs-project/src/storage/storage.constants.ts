export const S3_INTERNAL_CLIENT = Symbol('S3_INTERNAL_CLIENT');
export const S3_PUBLIC_CLIENT = Symbol('S3_PUBLIC_CLIENT');

export const CORS_ALLOWED_METHODS = ['PUT', 'GET', 'HEAD'];
export const CORS_EXPOSED_HEADERS = ['ETag'];
export const CORS_MAX_AGE_SECONDS = 3600;

/** Largest page `ListParts` returns. */
export const LIST_PARTS_PAGE_SIZE = 1000;
