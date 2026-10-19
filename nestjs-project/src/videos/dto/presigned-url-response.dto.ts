import { ApiProperty } from '@nestjs/swagger';

/** Shared by the stream, download and thumbnail routes. */
export class PresignedUrlResponseDto {
  @ApiProperty({
    description:
      'Presigned GET URL, signed for the public storage endpoint. Fetch it without an Authorization header.',
  })
  url: string;

  @ApiProperty({
    type: 'integer',
    example: 900,
    description: 'Seconds until the URL stops working',
  })
  expires_in: number;
}
