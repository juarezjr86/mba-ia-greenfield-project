import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import videosConfig from '../config/videos.config';
import { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PartUrlsResponseDto } from './dto/part-urls-response.dto';
import { PartUrlsDto } from './dto/part-urls.dto';
import { VideosService } from './videos.service';

// Replaces the global 10 requests per minute: a 10 GB upload is thousands of
// part requests. Both values are resolved on each request, after the .env
// file has been loaded into process.env.
@ApiTags('videos')
@Controller('videos')
@Throttle({
  default: {
    limit: () => videosConfig().throttleLimit,
    ttl: () => videosConfig().throttleTtlMs,
  },
})
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      'Creates the draft video and its multipart upload. The response tells the client how to slice the file; the parts are sent straight to storage and never pass through the API.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft video created',
    type: InitiateUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or size above the maximum',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'The user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description:
      'Too many requests: the limit of the videos routes was exceeded (plain throttler body, not the error envelope)',
  })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponseDto> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post(':id/upload/part-urls')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get presigned URLs for upload parts',
    description:
      'Returns one presigned URL per requested part number. The client sends each part with PUT straight to storage and keeps the ETag of every response for the completion call.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned URLs, in the order requested',
    type: PartUrlsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed, part number above the part count, or too many part numbers in one call',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid or expired access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'The video does not exist or belongs to another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'The upload was already completed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description:
      'Too many requests: the limit of the videos routes was exceeded (plain throttler body, not the error envelope)',
  })
  async createPartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PartUrlsDto,
  ): Promise<PartUrlsResponseDto> {
    return this.videosService.createPartUrls(user.sub, id, dto);
  }
}
