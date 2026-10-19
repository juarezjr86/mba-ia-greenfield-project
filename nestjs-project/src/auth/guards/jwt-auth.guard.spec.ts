import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

const TEST_SECRET = 'test-secret';

const STUB_HANDLER = jest.fn();
const STUB_CLASS = class {};

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => STUB_HANDLER,
    getClass: () => STUB_CLASS,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;
  let mockReflector: { getAllAndOverride: jest.Mock };

  /** Answers each metadata key on its own, as the real Reflector does. */
  function setMetadata(flags: { isPublic?: boolean; optionalAuth?: boolean }) {
    mockReflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return flags.isPublic ?? false;
      if (key === OPTIONAL_AUTH_KEY) return flags.optionalAuth ?? false;
      return false;
    });
  }

  beforeAll(async () => {
    mockReflector = { getAllAndOverride: jest.fn() };

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
    jwtService = module.get(JwtService);
  });

  beforeEach(() => {
    setMetadata({});
  });

  describe('protected routes', () => {
    it('passes with a valid JWT and attaches payload to request.user', async () => {
      const token = jwtService.sign({ sub: 'user-1', email: 'a@example.com' });
      const request: Record<string, unknown> = {
        headers: { authorization: `Bearer ${token}` },
      };
      const ctx = makeContext(request);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect((request.user as Record<string, unknown>)?.sub).toBe('user-1');
      expect((request.user as Record<string, unknown>)?.email).toBe(
        'a@example.com',
      );
    });

    it('throws UnauthorizedException when Authorization header is missing', async () => {
      const ctx = makeContext({ headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException on malformed Bearer token', async () => {
      const ctx = makeContext({
        headers: { authorization: 'Bearer not-a-valid-jwt' },
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException on expired JWT', async () => {
      const expiredToken = jwtService.sign(
        { sub: 'user-1', email: 'a@example.com' },
        { expiresIn: -60 },
      );
      const ctx = makeContext({
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('still requires a token when only @OptionalAuth() is present (no @Public())', async () => {
      setMetadata({ optionalAuth: true });
      const ctx = makeContext({ headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('@Public() routes', () => {
    beforeEach(() => {
      setMetadata({ isPublic: true });
    });

    it('bypasses the guard without a header', async () => {
      const request: Record<string, unknown> = { headers: {} };
      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('ignores an invalid token, as before (no @OptionalAuth())', async () => {
      const request: Record<string, unknown> = {
        headers: { authorization: 'Bearer lixo' },
      };
      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('ignores a valid token too: request.user stays unset', async () => {
      const token = jwtService.sign({ sub: 'user-1', email: 'a@example.com' });
      const request: Record<string, unknown> = {
        headers: { authorization: `Bearer ${token}` },
      };
      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });
  });

  describe('@Public() + @OptionalAuth() routes', () => {
    beforeEach(() => {
      setMetadata({ isPublic: true, optionalAuth: true });
    });

    it('treats a missing Authorization header as anonymous', async () => {
      const request: Record<string, unknown> = { headers: {} };
      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('sets request.user with a valid token', async () => {
      const token = jwtService.sign({ sub: 'user-1', email: 'a@example.com' });
      const request: Record<string, unknown> = {
        headers: { authorization: `Bearer ${token}` },
      };

      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
      expect((request.user as Record<string, unknown>)?.sub).toBe('user-1');
    });

    it('throws UnauthorizedException on an invalid token', async () => {
      const ctx = makeContext({
        headers: { authorization: 'Bearer not-a-valid-jwt' },
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException on an expired token', async () => {
      const expiredToken = jwtService.sign(
        { sub: 'user-1', email: 'a@example.com' },
        { expiresIn: -60 },
      );
      const ctx = makeContext({
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it.each([
      ['a non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
      ['a header without the scheme', 'lixo'],
      ['an empty Bearer token', 'Bearer '],
    ])('throws UnauthorizedException on %s', async (_label, header) => {
      const ctx = makeContext({ headers: { authorization: header } });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
