import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { Public } from '../../common/decorators/public.decorator';
import { AssetTokenService } from './asset-token.service';
import { UploadsService } from './uploads.service';

@ApiTags('Upload')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly assetTokens: AssetTokenService,
  ) {}

  @Get('question-assets/:filename/content')
  async content(
    @Param('filename') filename: string,
    @Query('action') action: 'preview' | 'download' = 'preview',
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: any,
  ) {
    const normalizedAction = action === 'download' ? 'download' : 'preview';
    const file = await this.uploadsService.authenticatedQuestionAsset(filename, user, normalizedAction);
    this.setContentHeaders(response, file.mimeType, file.displayName, normalizedAction === 'download' ? 'attachment' : 'inline');
    return new StreamableFile(file.stream);
  }

  @Public()
  @Get('public/questions/:questionId/assets/:filename')
  async publicContent(
    @Param('questionId') questionId: string,
    @Param('filename') filename: string,
    @Query('token') token: string,
    @Res({ passthrough: true }) response: any,
  ) {
    this.assetTokens.verifyPublicQuestionToken(token, questionId);
    const file = await this.uploadsService.publicQuestionAsset(questionId, filename);
    this.setContentHeaders(response, file.mimeType, file.displayName, 'inline');
    return new StreamableFile(file.stream);
  }

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

  @Patch('question-assets/:filename')
  @Permissions('question:create')
  renameFile(@Param('filename') filename: string, @Body() body: { displayName?: string; name?: string }) {
    return this.uploadsService.renameQuestionAsset(filename, body.displayName || body.name || '');
  }

  @Delete('question-assets/:filename')
  @Permissions('question:create')
  removeFile(@Param('filename') filename: string) {
    return this.uploadsService.removeQuestionAsset(filename);
  }

  private setContentHeaders(response: any, mimeType: string, displayName: string, disposition: 'inline' | 'attachment') {
    const encoded = encodeURIComponent(displayName).replace(/['()]/g, escape);
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encoded}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
  }
}
