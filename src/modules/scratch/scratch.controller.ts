import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { contentTypeWithCharset } from '../../common/http/content-type';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  CreateScratchAssignmentDto,
  CreateScratchTemplateDto,
  CreateScratchWorkDto,
  ReviewScratchWorkDto,
  SaveScratchWorkVersionDto,
  ScratchJudgeCallbackDto,
  ScratchStudentQueryDto,
  SubmitScratchWorkDto,
  UpdateScratchAssignmentDto,
  UpdateScratchTemplateDto,
} from './dto/scratch.dto';
import { ScratchAssignmentsService } from './scratch-assignments.service';
import { ScratchAssetsService, ScratchUploadFile } from './scratch-assets.service';
import { ScratchJudgeService } from './scratch-judge.service';
import { ScratchTemplatesService } from './scratch-templates.service';
import { ScratchWorksService } from './scratch-works.service';

type ScratchFiles = { project?: ScratchUploadFile[]; thumbnail?: ScratchUploadFile[] };
const ScratchFilesInterceptor = FileFieldsInterceptor(
  [{ name: 'project', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }],
  { limits: { fileSize: 50 * 1024 * 1024, files: 2 } },
);

@ApiTags('Scratch classroom')
@ApiBearerAuth()
@Controller('scratch')
export class ScratchController {
  constructor(
    private readonly templates: ScratchTemplatesService,
    private readonly assignments: ScratchAssignmentsService,
    private readonly works: ScratchWorksService,
    private readonly assets: ScratchAssetsService,
    private readonly judge: ScratchJudgeService,
  ) {}

  @Get('templates')
  @Permissions('scratch-template:read')
  listTemplates(@CurrentUser() actor: RequestUser) {
    return this.templates.list(actor);
  }

  @Post('templates')
  @Permissions('scratch-template:manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(ScratchFilesInterceptor)
  createTemplate(
    @UploadedFiles() files: ScratchFiles,
    @Body() dto: CreateScratchTemplateDto,
    @CurrentUser() actor: RequestUser,
  ) {
    const project = files?.project?.[0];
    if (!project) throw new BadRequestException('请上传 .sb3 模板文件');
    return this.templates.create(dto, project, files.thumbnail?.[0], actor);
  }

  @Patch('templates/:id')
  @Permissions('scratch-template:manage')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateScratchTemplateDto, @CurrentUser() actor: RequestUser) {
    return this.templates.update(id, dto, actor);
  }

  @Get('sessions/:sessionId/assignments')
  @Permissions('scratch-assignment:read')
  listAssignments(
    @Param('sessionId') sessionId: string,
    @Query() query: ScratchStudentQueryDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.assignments.listSession(sessionId, actor, query.studentId);
  }

  @Post('sessions/:sessionId/assignments')
  @Permissions('scratch-assignment:manage')
  createAssignment(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateScratchAssignmentDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.assignments.create(sessionId, dto, actor);
  }

  @Patch('assignments/:id')
  @Permissions('scratch-assignment:manage')
  updateAssignment(@Param('id') id: string, @Body() dto: UpdateScratchAssignmentDto, @CurrentUser() actor: RequestUser) {
    return this.assignments.update(id, dto, actor);
  }

  @Post('assignments/:id/publish')
  @Permissions('scratch-assignment:publish')
  publishAssignment(@Param('id') id: string, @CurrentUser() actor: RequestUser) {
    return this.assignments.publish(id, actor);
  }

  @Post('assignments/:id/archive')
  @Permissions('scratch-assignment:publish')
  archiveAssignment(@Param('id') id: string, @CurrentUser() actor: RequestUser) {
    return this.assignments.archive(id, actor);
  }

  @Get('students/:studentId/assignments')
  @Permissions('scratch-assignment:read')
  studentAssignments(@Param('studentId') studentId: string, @CurrentUser() actor: RequestUser) {
    return this.assignments.studentOverview(studentId, actor);
  }

  @Post('assignments/:id/work')
  @Permissions('scratch-work:save')
  createWork(@Param('id') id: string, @Body() dto: CreateScratchWorkDto, @CurrentUser() actor: RequestUser) {
    return this.works.create(id, dto, actor);
  }

  @Get('works/:id')
  @Permissions('scratch-work:read')
  work(@Param('id') id: string, @CurrentUser() actor: RequestUser) {
    return this.works.detail(id, actor);
  }

  @Post('works/:id/versions')
  @Permissions('scratch-work:save')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(ScratchFilesInterceptor)
  saveVersion(
    @Param('id') id: string,
    @UploadedFiles() files: ScratchFiles,
    @Body() dto: SaveScratchWorkVersionDto,
    @CurrentUser() actor: RequestUser,
  ) {
    const project = files?.project?.[0];
    if (!project) throw new BadRequestException('请上传 .sb3 作品文件');
    return this.works.saveVersion(id, dto, project, files.thumbnail?.[0], actor);
  }

  @Post('works/:id/submit')
  @Permissions('scratch-work:submit')
  submitWork(@Param('id') id: string, @Body() dto: SubmitScratchWorkDto, @CurrentUser() actor: RequestUser) {
    return this.works.submit(id, dto, actor);
  }

  @Post('works/:id/reviews')
  @Permissions('scratch-work:review')
  reviewWork(@Param('id') id: string, @Body() dto: ReviewScratchWorkDto, @CurrentUser() actor: RequestUser) {
    return this.works.review(id, dto, actor);
  }

  @Post('judge-runs/:id/retry')
  @Permissions('scratch-judge:manage')
  retryJudge(@Param('id') id: string, @CurrentUser() actor: RequestUser) {
    return this.works.retryJudge(id, actor);
  }

  @Get('templates/:id/project')
  @Permissions('scratch-asset:download')
  async templateProject(
    @Param('id') id: string,
    @Query() query: ScratchStudentQueryDto,
    @CurrentUser() actor: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.fileResponse(await this.assets.templateContent(id, 'project', actor, query.studentId), response);
  }

  @Get('templates/:id/thumbnail')
  @Permissions('scratch-asset:download')
  async templateThumbnail(
    @Param('id') id: string,
    @Query() query: ScratchStudentQueryDto,
    @CurrentUser() actor: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.fileResponse(await this.assets.templateContent(id, 'thumbnail', actor, query.studentId), response);
  }

  @Get('work-versions/:id/project')
  @Permissions('scratch-asset:download')
  async versionProject(@Param('id') id: string, @CurrentUser() actor: RequestUser, @Res({ passthrough: true }) response: Response) {
    return this.fileResponse(await this.assets.versionContent(id, 'project', actor), response);
  }

  @Get('work-versions/:id/thumbnail')
  @Permissions('scratch-asset:download')
  async versionThumbnail(@Param('id') id: string, @CurrentUser() actor: RequestUser, @Res({ passthrough: true }) response: Response) {
    return this.fileResponse(await this.assets.versionContent(id, 'thumbnail', actor), response);
  }

  @Public()
  @Post('judge-callbacks/:runId')
  judgeCallback(
    @Param('runId') runId: string,
    @Body() dto: ScratchJudgeCallbackDto,
    @Headers('x-scratch-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(dto));
    return this.judge.callback(runId, dto, rawBody, signature);
  }

  private fileResponse(file: { displayName: string; mimeType: string; stream: NodeJS.ReadableStream }, response: Response) {
    const encoded = encodeURIComponent(file.displayName).replace(/['()]/g, escape);
    response.setHeader('Content-Type', contentTypeWithCharset(file.mimeType));
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encoded}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.stream as any);
  }
}
