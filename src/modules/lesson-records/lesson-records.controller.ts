import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { contentTypeWithCharset } from '../../common/http/content-type';
import {
  LessonAssetMetadataDto,
  LessonRecordTransitionDto,
  QueryLessonRecordDto,
  SaveLessonRecordDto,
} from './dto/lesson-record.dto';
import { LessonAssetsService } from './lesson-assets.service';
import { LessonRecordsService } from './lesson-records.service';

@ApiTags('Lesson record')
@ApiBearerAuth()
@Controller('lesson-records')
export class LessonRecordsController {
  constructor(
    private readonly records: LessonRecordsService,
    private readonly assets: LessonAssetsService,
  ) {}

  @Get()
  @Permissions('lesson-record:read')
  list(@Query() query: QueryLessonRecordDto, @CurrentUser() actor: RequestUser) {
    return this.records.list(query, actor);
  }

  @Get(':sessionId')
  @Permissions('lesson-record:read')
  detail(
    @Param('sessionId') sessionId: string,
    @Query('studentId') studentId: string | undefined,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.records.detail(sessionId, actor, studentId);
  }

  @Put(':sessionId/draft')
  @Permissions('lesson-record:manage')
  saveDraft(
    @Param('sessionId') sessionId: string,
    @Body() dto: SaveLessonRecordDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.records.saveDraft(sessionId, dto, actor);
  }

  @Post(':sessionId/submit')
  @Permissions('lesson-record:manage')
  submit(
    @Param('sessionId') sessionId: string,
    @Body() dto: LessonRecordTransitionDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.records.submit(sessionId, dto, actor);
  }

  @Post(':sessionId/publish')
  @Permissions('lesson-record:publish')
  publish(
    @Param('sessionId') sessionId: string,
    @Body() dto: LessonRecordTransitionDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.records.publish(sessionId, dto, actor);
  }

  @Get(':sessionId/versions')
  @Permissions('lesson-record:manage')
  versions(@Param('sessionId') sessionId: string, @CurrentUser() actor: RequestUser) {
    return this.records.versionHistory(sessionId, actor);
  }

  @Post(':sessionId/assets')
  @Permissions('lesson-asset:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  uploadAsset(
    @Param('sessionId') sessionId: string,
    @UploadedFile() file: any,
    @Body() dto: LessonAssetMetadataDto,
    @CurrentUser() actor: RequestUser,
  ) {
    if (!file) throw new BadRequestException('请上传文件，单个文件不超过 50MB');
    return this.assets.upload(sessionId, file, dto, actor);
  }

  @Delete(':sessionId/assets/:assetId')
  @Permissions('lesson-asset:manage')
  removeAsset(
    @Param('sessionId') sessionId: string,
    @Param('assetId') assetId: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.assets.remove(sessionId, assetId, actor);
  }

  @Get(':sessionId/assets/:assetId/content')
  @Permissions('lesson-asset:download')
  async assetContent(
    @Param('sessionId') sessionId: string,
    @Param('assetId') assetId: string,
    @Query('studentId') studentId: string | undefined,
    @Query('action') action: 'preview' | 'download' = 'preview',
    @CurrentUser() actor: RequestUser,
    @Res({ passthrough: true }) response: any,
  ) {
    const file = await this.assets.content(sessionId, assetId, actor, studentId);
    const disposition = action === 'download' ? 'attachment' : 'inline';
    const encoded = encodeURIComponent(file.displayName).replace(/['()]/g, escape);
    response.setHeader('Content-Type', contentTypeWithCharset(file.mimeType));
    response.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encoded}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.stream);
  }
}
