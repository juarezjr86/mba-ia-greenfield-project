import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSpec } from './openapi-export';

describe('exportSpec (integration)', () => {
  let outputPath: string;
  let document: Record<string, unknown>;

  beforeAll(async () => {
    outputPath = join(tmpdir(), `openapi-test-${Date.now()}.json`);
    await exportSpec(outputPath);
    document = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<
      string,
      unknown
    >;
  }, 30_000);

  it('exports a valid OpenAPI 3.x document', () => {
    expect(document.openapi).toMatch(/^3\./);
  });

  it('sets info.title to "StreamTube API"', () => {
    const info = document.info as Record<string, unknown>;
    expect(info.title).toBe('StreamTube API');
  });

  it('sets info.version to "1.0"', () => {
    const info = document.info as Record<string, unknown>;
    expect(info.version).toBe('1.0');
  });

  it('includes access-token Bearer security scheme', () => {
    const components = document.components as Record<string, unknown>;
    const schemes = components.securitySchemes as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemes['access-token']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('includes non-empty components.schemas from DTO inference', () => {
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    expect(Object.keys(schemas).length).toBeGreaterThan(0);
  });

  it('includes ApiErrorEnvelope schema with expected properties', () => {
    const components = document.components as Record<string, unknown>;
    const schemas = components.schemas as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemas['ApiErrorEnvelope']).toBeDefined();
    const props = schemas['ApiErrorEnvelope'].properties as Record<
      string,
      unknown
    >;
    expect(props).toHaveProperty('statusCode');
    expect(props).toHaveProperty('error');
    expect(props).toHaveProperty('message');
    expect(props).toHaveProperty('code');
  });

  it('has at least one path with a 401 response referencing ApiErrorEnvelope', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const apiErrorRef = '#/components/schemas/ApiErrorEnvelope';

    const hasRef = Object.values(paths).some((methods) =>
      Object.values(methods).some((operation) => {
        const responses = operation.responses as Record<
          string,
          Record<string, unknown>
        >;
        const r401 = responses?.['401'];
        if (!r401) return false;
        const content = r401.content as Record<string, Record<string, unknown>>;
        const jsonContent = content?.['application/json'];
        const schema = jsonContent?.schema as Record<string, unknown>;
        return schema?.['$ref'] === apiErrorRef;
      }),
    );

    expect(hasRef).toBe(true);
  });

  it('protected auth endpoints include access-token security requirement', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const protectedPaths = [
      { path: '/auth/logout', method: 'post' },
      { path: '/auth/me', method: 'get' },
    ];

    for (const { path, method } of protectedPaths) {
      const operation = paths[path]?.[method];
      expect(operation).toBeDefined();
      const security = operation?.security as Array<Record<string, unknown>>;
      expect(security).toBeDefined();
      expect(security.some((req) => 'access-token' in req)).toBe(true);
    }
  });

  it('all auth endpoints have a non-empty summary', () => {
    const paths = document.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const authPaths = Object.entries(paths).filter(([p]) =>
      p.startsWith('/auth/'),
    );

    expect(authPaths.length).toBeGreaterThan(0);

    for (const [, methods] of authPaths) {
      for (const operation of Object.values(methods)) {
        expect(typeof operation.summary).toBe('string');
        expect((operation.summary as string).length).toBeGreaterThan(0);
      }
    }
  });

  describe('videos operations', () => {
    type Operation = { responses: Record<string, Record<string, unknown>> };
    const VIDEO_OPERATIONS = [
      { method: 'post', path: '/videos' },
      { method: 'get', path: '/videos/{id}' },
      { method: 'post', path: '/videos/{id}/upload/part-urls' },
      { method: 'get', path: '/videos/{id}/upload/parts' },
      { method: 'post', path: '/videos/{id}/upload/complete' },
      { method: 'get', path: '/videos/{id}/stream' },
      { method: 'get', path: '/videos/{id}/download' },
      { method: 'get', path: '/videos/{id}/thumbnail' },
    ];
    const envelopeRef = '#/components/schemas/ApiErrorEnvelope';

    const operationOf = (
      doc: Record<string, unknown>,
      path: string,
      method: string,
    ): Operation | undefined =>
      (doc.paths as Record<string, Record<string, Operation>>)[path]?.[method];

    it('lists the eight operations of the phase', () => {
      for (const { method, path } of VIDEO_OPERATIONS) {
        expect(operationOf(document, path, method)).toBeDefined();
      }
    });

    it('points every error response at ApiErrorEnvelope, except the plain throttler 429', () => {
      for (const { method, path } of VIDEO_OPERATIONS) {
        const operation = operationOf(document, path, method) as Operation;
        const errorCodes = Object.keys(operation.responses).filter(
          (code) => Number(code) >= 400 && code !== '429',
        );
        expect(errorCodes).toEqual(expect.arrayContaining(['400', '404']));
        for (const code of errorCodes) {
          const content = operation.responses[code].content as Record<
            string,
            { schema: Record<string, unknown> }
          >;
          expect({
            path,
            code,
            ref: content['application/json'].schema['$ref'],
          }).toEqual({ path, code, ref: envelopeRef });
        }
      }
    });

    it('requires the access token only on the owner routes', () => {
      const secured = (path: string, method: string): boolean =>
        Boolean(
          (operationOf(document, path, method) as Record<string, unknown>)
            .security,
        );
      const ownerRoutes = VIDEO_OPERATIONS.filter(
        ({ path }) => path === '/videos' || path.includes('/upload/'),
      );
      for (const { method, path } of VIDEO_OPERATIONS) {
        expect({ path, secured: secured(path, method) }).toEqual({
          path,
          secured: ownerRoutes.some((route) => route.path === path),
        });
      }
    });

    it('describes the response DTOs with their properties', () => {
      const schemas = (document.components as Record<string, unknown>)
        .schemas as Record<string, { properties?: Record<string, unknown> }>;
      const responseDtos = {
        InitiateUploadResponseDto: ['id', 'part_size_bytes', 'part_count'],
        PartUrlsResponseDto: ['urls', 'expires_in'],
        UploadedPartsResponseDto: ['parts'],
        CompleteUploadResponseDto: ['id', 'status'],
        VideoResponseDto: [
          'id',
          'status',
          'original_filename',
          'failure_reason',
        ],
        PresignedUrlResponseDto: ['url', 'expires_in'],
        DownloadUrlResponseDto: ['url', 'expires_in', 'filename'],
      };
      for (const [name, properties] of Object.entries(responseDtos)) {
        expect(Object.keys(schemas[name]?.properties ?? {})).toEqual(
          expect.arrayContaining(properties),
        );
      }
    });

    it('is the committed openapi.json that lists the same operations', () => {
      const committed = JSON.parse(
        readFileSync(join(process.cwd(), 'openapi.json'), 'utf-8'),
      ) as Record<string, unknown>;
      for (const { method, path } of VIDEO_OPERATIONS) {
        expect(operationOf(committed, path, method)).toBeDefined();
      }
    });
  });
});
