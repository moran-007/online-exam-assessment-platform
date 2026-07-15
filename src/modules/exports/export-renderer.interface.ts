import { RequestUser } from '../../common/interfaces/request-user.interface';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportsContext } from './exports.context';

export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'pdf' | 'docx' | 'zip';

export type ExportRenderJob = {
  taskId: string;
  dto: CreateExportDto;
  user: RequestUser;
};

export interface ExportRenderer {
  readonly formats: readonly ExportFormat[];
  render(ctx: ExportsContext, job: ExportRenderJob): Promise<string>;
}
