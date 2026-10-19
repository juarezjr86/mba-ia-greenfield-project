import { ApiProperty } from '@nestjs/swagger';
import { PresignedUrlResponseDto } from './presigned-url-response.dto';

export class DownloadUrlResponseDto extends PresignedUrlResponseDto {
  @ApiProperty({
    example: 'Vídeo ação.mp4',
    description:
      'Name the browser saves the file under (the original file name). It is also signed into the URL as the content-disposition.',
  })
  filename: string;
}
