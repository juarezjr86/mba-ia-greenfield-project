import { ApiProperty } from '@nestjs/swagger';

export class UploadedPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({ example: 67108864 })
  size_bytes: number;

  @ApiProperty({ example: '"9bb58f26192e4ba00f01e2e7b136bbd8"' })
  etag: string;
}

export class UploadedPartsResponseDto {
  @ApiProperty({ example: 67108864 })
  part_size_bytes: number;

  @ApiProperty({ example: 2 })
  part_count: number;

  @ApiProperty({
    type: [UploadedPartDto],
    description: 'Parts already stored, ordered by part number',
  })
  parts: UploadedPartDto[];
}
