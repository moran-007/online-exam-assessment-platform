import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { UploadsService } from './uploads.service';

@ApiTags('Upload')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Get('question-assets/report')
  @Permissions('question:create')
  questionAssetReport() {
    return this.uploadsService.questionAssetReport();
  }

  @Get('question-assets/:filename/references')
  @Permissions('question:read')
  questionAssetReferences(@Param('filename') filename: string) {
    return this.uploadsService.questionAssetReferences(filename);
  }

  @Post('question-assets/cleanup-orphans')
  @Permissions('question:create')
  cleanupOrphanQuestionAssets() {
    return this.uploadsService.cleanupOrphanQuestionAssets();
  }

  @Post('question-assets')
  @Permissions('question:create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 30 * 1024 * 1024 },
    }),
  )
  async uploadFile(@UploadedFile() file: any, @CurrentUser() user: RequestUser) {
    if (!file) {
      throw new BadRequestException('请上传文件，单个文件不超过 30MB');
    }

    return this.uploadsService.saveQuestionAsset(file, user.id);
  }

  @Post('files')
  @Permissions('question:create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 30 * 1024 * 1024 },
    }),
  )
  async uploadLegacyFile(@UploadedFile() file: any, @CurrentUser() user: RequestUser) {
    if (!file) {
      throw new BadRequestException('请上传文件，单个文件不超过 30MB');
    }

    return this.uploadsService.saveQuestionAsset(file, user.id);
  }

  @Patch('question-assets/:filename')
  @Permissions('question:create')
  renameFile(@Param('filename') filename: string, @Body() body: { displayName?: string; name?: string }) {
    return this.uploadsService.renameQuestionAsset(filename, body.displayName || body.name || '');
  }

  @Patch('files/:filename')
  @Permissions('question:create')
  renameLegacyFile(@Param('filename') filename: string, @Body() body: { displayName?: string; name?: string }) {
    return this.uploadsService.renameQuestionAsset(filename, body.displayName || body.name || '');
  }

  @Delete('question-assets/:filename')
  @Permissions('question:create')
  removeFile(@Param('filename') filename: string) {
    return this.uploadsService.removeQuestionAsset(filename);
  }

  @Delete('files/:filename')
  @Permissions('question:create')
  removeLegacyFile(@Param('filename') filename: string) {
    return this.uploadsService.removeQuestionAsset(filename);
  }

  @Post('images')
  @Permissions('question:create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        callback(null, Boolean(file.mimetype?.startsWith('image/')));
      },
    }),
  )
  async uploadImage(@UploadedFile() file: any, @CurrentUser() user: RequestUser) {
    if (!file) {
      throw new BadRequestException('请上传图片文件，单张不超过 8MB');
    }

    return this.uploadsService.saveImage(file, user.id);
  }
}
