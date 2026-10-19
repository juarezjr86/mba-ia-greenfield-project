import { ApiProperty } from '@nestjs/swagger';

export class PartUrlDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({
    description:
      'Presigned URL: send the part bytes with PUT straight to storage',
  })
  url: string;
}

export class PartUrlsResponseDto {
  @ApiProperty({ type: [PartUrlDto] })
  urls: PartUrlDto[];

  @ApiProperty({
    description: 'Seconds the URLs stay valid',
    example: 3600,
  })
  expires_in: number;
}
