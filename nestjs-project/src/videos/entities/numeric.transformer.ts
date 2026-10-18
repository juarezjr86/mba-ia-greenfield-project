import type { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL returns `bigint` and `numeric` columns as strings. Every value this
 * module stores (up to 10 GB in bytes, durations, bit rates) fits in a JS number.
 */
export const numberTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};
