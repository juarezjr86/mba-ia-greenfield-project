export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class ChannelNotFoundException extends DomainException {
  constructor() {
    super('CHANNEL_NOT_FOUND', 404, 'Channel not found for the current user');
  }
}

export class UploadSizeExceededException extends DomainException {
  constructor(maxSizeBytes: number) {
    super(
      'UPLOAD_SIZE_EXCEEDED',
      400,
      `File size exceeds the maximum of ${maxSizeBytes} bytes`,
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoNotInDraftException extends DomainException {
  constructor() {
    super('VIDEO_NOT_IN_DRAFT', 409, 'The video upload was already completed');
  }
}

export class UploadIncompleteException extends DomainException {
  constructor(storedParts: number, expectedParts: number) {
    super(
      'UPLOAD_INCOMPLETE',
      409,
      `Only ${storedParts} of ${expectedParts} parts were uploaded`,
    );
  }
}

export class VideoAlreadyProcessedException extends DomainException {
  constructor() {
    super('VIDEO_ALREADY_PROCESSED', 409, 'The video was already processed');
  }
}

export class VideoSizeMismatchException extends DomainException {
  constructor(declaredBytes: number, storedBytes: number) {
    super(
      'VIDEO_SIZE_MISMATCH',
      422,
      `Uploaded size (${storedBytes} bytes) differs from the declared size (${declaredBytes} bytes)`,
    );
  }
}

export class FileNotAvailableException extends DomainException {
  constructor() {
    super(
      'VIDEO_FILE_NOT_AVAILABLE',
      409,
      'The video file is not available yet: the upload was not completed',
    );
  }
}

export class ThumbnailNotAvailableException extends DomainException {
  constructor() {
    super(
      'THUMBNAIL_NOT_AVAILABLE',
      409,
      'The video has no thumbnail: it was not processed yet, or processing failed',
    );
  }
}

export class InvalidPartNumbersException extends DomainException {
  constructor(partCount: number) {
    super(
      'INVALID_PART_NUMBERS',
      400,
      `Part numbers must be between 1 and ${partCount}`,
    );
  }
}

export class PartUrlsBatchTooLargeException extends DomainException {
  constructor(maxBatch: number) {
    super(
      'PART_URLS_BATCH_TOO_LARGE',
      400,
      `At most ${maxBatch} part numbers can be requested at once`,
    );
  }
}
