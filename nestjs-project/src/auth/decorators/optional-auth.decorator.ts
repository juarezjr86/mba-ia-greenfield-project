import { SetMetadata } from '@nestjs/common';

export const OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Opt-in for a route that is also `@Public()`: no `Authorization` header is an
 * anonymous call, a valid token sets `request.user`, and a header that is
 * present but malformed, invalid or expired is a 401. Without `@Public()` the
 * route stays protected (no token is a 401), so both decorators are needed.
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);
