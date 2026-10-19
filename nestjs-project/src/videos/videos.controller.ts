import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import videosConfig from '../config/videos.config';
import { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PartUrlsResponseDto } from './dto/part-urls-response.dto';
import { PartUrlsDto } from './dto/part-urls.dto';
import { UploadedPartsResponseDto } from './dto/uploaded-parts-response.dto';
import { toVideoResponse, VideoResponseDto } from './dto/video-response.dto';
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

  @Get(':id/upload/parts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List the parts already uploaded',
    description:
      'Lists the parts storage already holds, ordered by part number, so an interrupted client resumes by sending only the missing ones.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stored parts (empty when none was sent yet)',
    type: UploadedPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'The video id is not a uuid',
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
  async listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UploadedPartsResponseDto> {
    return this.videosService.listUploadedParts(user.sub, id);
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete the upload and start processing',
    description:
      'Finalizes the multipart upload from the parts storage holds, checks the stored size, moves the video to processing and enqueues its job. Calling it again while the video is processing is safe and returns the same response.',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed; the video is being processed',
    type: CompleteUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'The video id is not a uuid',
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
    description:
      'Fewer parts than expected were uploaded (UPLOAD_INCOMPLETE), or the video is already ready or failed (VIDEO_ALREADY_PROCESSED)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description: 'The uploaded size differs from the declared size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description:
      'Too many requests: the limit of the videos routes was exceeded (plain throttler body, not the error envelope)',
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CompleteUploadResponseDto> {
    return this.videosService.completeUpload(user.sub, id);
  }

  @Get(':id')
  @Public()
  @OptionalAuth()
  @ApiHeader({
    name: 'Authorization',
    required: false,
    description:
      'Optional `Bearer <access_token>`. Without it the caller is anonymous and sees only ready videos; a token that is sent but invalid or expired is a 401.',
  })
  @ApiOperation({
    summary: 'Get a video',
    description:
      'Metadata and status of a video, at its unique URL. The owner reads the video in any status (and sees `failure_reason`); everyone else, including anonymous visitors, only when it is ready. A hidden video answers 404, so a draft is not revealed.',
  })
  @ApiResponse({
    status: 200,
    description: 'The video',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'The video id is not a uuid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'An access token was sent but is invalid or expired',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description:
      'The video does not exist, or it is not ready and the caller is not its owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 429,
    description:
      'Too many requests: the limit of the videos routes was exceeded (plain throttler body, not the error envelope)',
  })
  async getVideo(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoResponseDto> {
    const { video, isOwner } = await this.videosService.getVisibleVideo(
      user?.sub,
      id,
    );
    return toVideoResponse(video, isOwner);
  }
}
