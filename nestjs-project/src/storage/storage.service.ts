import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  NoSuchUpload,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import {
  CORS_ALLOWED_METHODS,
  CORS_EXPOSED_HEADERS,
  CORS_MAX_AGE_SECONDS,
  LIST_PARTS_PAGE_SIZE,
  S3_INTERNAL_CLIENT,
  S3_PUBLIC_CLIENT,
} from './storage.constants';

export interface StoredPart {
  partNumber: number;
  sizeBytes: number;
  etag: string;
}

export interface UploadedPartRef {
  partNumber: number;
  etag: string;
}

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | undefined;
}

export type StorageClientKind = 'public' | 'internal';

export interface PresignGetOptions {
  expiresIn: number;
  /** Which client signs: `public` for URLs handed to users, `internal` for the worker. */
  client: StorageClientKind;
  /** When set, the URL forces a download with this file name. */
  downloadFilename?: string;
}

/**
 * True when storage no longer knows the multipart upload: it was completed
 * (or aborted) already. Storage answers `NoSuchUpload` with status 404 for
 * `ListParts` and `CompleteMultipartUpload` (checked against the pinned silo).
 */
export function isNoSuchUpload(err: unknown): boolean {
  return err instanceof NoSuchUpload;
}

function isHttpStatus(err: unknown, status: number): boolean {
  return (
    err instanceof S3ServiceException && err.$metadata.httpStatusCode === status
  );
}

function buildContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Injectable()
export class StorageService implements OnModuleDestroy {
  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    @Inject(S3_INTERNAL_CLIENT) private readonly internalClient: S3Client,
    @Inject(S3_PUBLIC_CLIENT) private readonly publicClient: S3Client,
  ) {}

  onModuleDestroy(): void {
    this.internalClient.destroy();
    this.publicClient.destroy();
  }

  /**
   * Creates the bucket when absent and (re)applies its CORS rules. Safe to run
   * any number of times, from the bootstrap script or from test setup.
   */
  async ensureBucket(): Promise<void> {
    const Bucket = this.config.bucket;
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket }));
    } catch (err) {
      if (!isHttpStatus(err, 404)) throw err;
      try {
        await this.internalClient.send(new CreateBucketCommand({ Bucket }));
      } catch (createErr) {
        // Another process created it between HeadBucket and CreateBucket.
        const alreadyThere =
          createErr instanceof S3ServiceException &&
          (createErr.name === 'BucketAlreadyOwnedByYou' ||
            createErr.name === 'BucketAlreadyExists');
        if (!alreadyThere) throw createErr;
      }
    }

    await this.internalClient.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedMethods: CORS_ALLOWED_METHODS,
              AllowedOrigins: this.config.corsAllowedOrigins
                .split(',')
                .map((origin) => origin.trim())
                .filter((origin) => origin.length > 0),
              AllowedHeaders: ['*'],
              ExposeHeaders: CORS_EXPOSED_HEADERS,
              MaxAgeSeconds: CORS_MAX_AGE_SECONDS,
            },
          ],
        },
      }),
    );
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!UploadId) {
      throw new Error('Storage did not return an UploadId');
    }
    return UploadId;
  }

  presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn },
    );
  }

  /** Lists every part already stored, following `ListParts` pagination. */
  async listAllParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let partNumberMarker: string | undefined;

    do {
      const page = await this.internalClient.send(
        new ListPartsCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          MaxParts: LIST_PARTS_PAGE_SIZE,
          PartNumberMarker: partNumberMarker,
        }),
      );
      for (const part of page.Parts ?? []) {
        parts.push({
          partNumber: part.PartNumber!,
          sizeBytes: part.Size!,
          etag: part.ETag!,
        });
      }
      partNumberMarker = page.IsTruncated
        ? page.NextPartNumberMarker
        : undefined;
    } while (partNumberMarker !== undefined);

    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPartRef[],
  ): Promise<void> {
    await this.internalClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );
  }

  /** Returns the stored object's size and type, or `null` when it does not exist. */
  async headObject(key: string): Promise<StoredObjectInfo | null> {
    try {
      const head = await this.internalClient.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        sizeBytes: head.ContentLength ?? 0,
        contentType: head.ContentType,
      };
    } catch (err) {
      if (isHttpStatus(err, 404)) return null;
      throw err;
    }
  }

  presignGet(key: string, options: PresignGetOptions): Promise<string> {
    const client =
      options.client === 'public' ? this.publicClient : this.internalClient;
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(options.downloadFilename !== undefined && {
          ResponseContentDisposition: buildContentDisposition(
            options.downloadFilename,
          ),
        }),
      }),
      { expiresIn: options.expiresIn },
    );
  }

  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Streams the object to a local file. Used only by the per-job fallback of TD-07. */
  async downloadToFile(key: string, path: string): Promise<void> {
    const { Body } = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!(Body instanceof Readable)) {
      throw new Error(`Storage returned no readable body for ${key}`);
    }
    await pipeline(Body, createWriteStream(path));
  }
}
