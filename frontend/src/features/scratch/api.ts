import { apiWire } from '../../api';

export type ScratchStatus = 'draft' | 'submitted' | 'reviewed';
export type AssignmentStatus = 'draft' | 'published' | 'archived';
export type JudgeMode = 'none' | 'manual' | 'external';

export interface ScratchFileView {
  id: string;
  fileName: string;
  fileSize: string;
  sha256: string;
}

export interface ScratchTemplateView {
  id: string;
  title: string;
  description: string | null;
  status: 'active' | 'archived';
  runtimeProblemUrl: string | null;
  project: ScratchFileView;
  thumbnail: ScratchFileView | null;
  assignmentCount: number;
  updatedAt: string;
}

export interface ScratchWorkListItem {
  id: string;
  title: string;
  status: ScratchStatus;
  currentVersion: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  student?: { id: string; username: string; realName: string | null };
  latestReview?: ScratchReviewView | null;
  latestJudgeRun?: ScratchJudgeRunView | null;
  updatedAt: string;
}

export interface ScratchAssignmentView {
  id: string;
  sessionId: string;
  title: string;
  statementMd: string | null;
  bindNote?: string | null;
  dueAt: string | null;
  maxScore: number;
  status: AssignmentStatus;
  judgeMode: JudgeMode;
  publishedAt: string | null;
  template: {
    id: string;
    title: string;
    description: string | null;
    runtimeProblemUrl: string | null;
    projectFileName: string;
    thumbnailAvailable: boolean;
  };
  workCount?: number;
  works: ScratchWorkListItem[];
  session?: { id: string; title: string; startsAt: string; classId: string; className: string };
}

export interface ScratchVersionView {
  id: string;
  version: number;
  source: 'template_copy' | 'student_save' | 'submission' | 'import';
  note: string | null;
  project: ScratchFileView;
  thumbnailAvailable: boolean;
  createdAt: string;
}

export interface ScratchReviewView {
  id?: string;
  workVersionId?: string;
  score: number | null;
  comment: string | null;
  reviewer?: { id: string; username: string; realName: string | null };
  createdAt: string;
}

export interface ScratchJudgeRunView {
  id: string;
  workVersionId?: string;
  status: string;
  attemptCount?: number;
  score: number | null;
  passed?: boolean | null;
  message: string | null;
  requestedAt?: string | null;
  finishedAt?: string | null;
}

export interface ScratchWorkView extends Omit<ScratchWorkListItem, 'latestReview' | 'latestJudgeRun' | 'updatedAt'> {
  submitNote: string | null;
  assignment: {
    id: string;
    title: string;
    maxScore: number;
    judgeMode: JudgeMode;
    dueAt: string | null;
    session: { id: string; title: string; classId: string; className: string };
  };
  versions: ScratchVersionView[];
  reviews: ScratchReviewView[];
  judgeRuns: ScratchJudgeRunView[];
}

const data = async <T>(request: Promise<unknown>) => ((await request) as { data: T }).data;

export const listScratchTemplates = () => data<ScratchTemplateView[]>(apiWire('/scratch/templates'));

export function createScratchTemplate(input: { title: string; description?: string; project: File; thumbnail?: File }) {
  const body = new FormData();
  body.append('title', input.title);
  if (input.description) body.append('description', input.description);
  body.append('project', input.project);
  if (input.thumbnail) body.append('thumbnail', input.thumbnail);
  return data<ScratchTemplateView>(apiWire('/scratch/templates', { method: 'POST', body }));
}

export const listSessionScratchAssignments = (sessionId: string) =>
  data<ScratchAssignmentView[]>(apiWire(`/scratch/sessions/${sessionId}/assignments`));

export const createScratchAssignment = (
  sessionId: string,
  body: { templateId: string; title: string; statementMd?: string; maxScore: number; judgeMode: JudgeMode },
) => data<ScratchAssignmentView>(apiWire(`/scratch/sessions/${sessionId}/assignments`, {
  method: 'POST',
  body: { ...body, judgeMode: body.judgeMode.toUpperCase() },
}));

export const publishScratchAssignment = (id: string) =>
  data<ScratchAssignmentView>(apiWire(`/scratch/assignments/${id}/publish`, { method: 'POST' }));

export const archiveScratchAssignment = (id: string) =>
  data<ScratchAssignmentView>(apiWire(`/scratch/assignments/${id}/archive`, { method: 'POST' }));

export const listStudentScratchAssignments = (studentId: string) =>
  data<ScratchAssignmentView[]>(apiWire(`/scratch/students/${studentId}/assignments`));

export const createScratchWork = (assignmentId: string, title?: string) =>
  data<ScratchWorkView>(apiWire(`/scratch/assignments/${assignmentId}/work`, { method: 'POST', body: { title } }));

export const getScratchWork = (id: string) => data<ScratchWorkView>(apiWire(`/scratch/works/${id}`));

export function saveScratchWorkVersion(id: string, input: { project: File; thumbnail?: File; note?: string }) {
  const body = new FormData();
  body.append('project', input.project);
  if (input.thumbnail) body.append('thumbnail', input.thumbnail);
  if (input.note) body.append('note', input.note);
  return data<ScratchWorkView>(apiWire(`/scratch/works/${id}/versions`, { method: 'POST', body }));
}

export const submitScratchWork = (id: string, submitNote?: string) =>
  data<ScratchWorkView>(apiWire(`/scratch/works/${id}/submit`, { method: 'POST', body: { submitNote } }));

export const reviewScratchWork = (id: string, body: { score?: number; comment?: string }) =>
  data<ScratchWorkView>(apiWire(`/scratch/works/${id}/reviews`, { method: 'POST', body }));

export const retryScratchJudge = (id: string) =>
  data<{ id: string; status: string }>(apiWire(`/scratch/judge-runs/${id}/retry`, { method: 'POST' }));

export async function downloadScratchAsset(path: string, fileName: string) {
  const response = await apiWire(path);
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const downloadScratchTemplate = (template: ScratchAssignmentView['template'], studentId?: string) =>
  downloadScratchAsset(
    `/scratch/templates/${template.id}/project${studentId ? `?studentId=${encodeURIComponent(studentId)}` : ''}`,
    template.projectFileName,
  );

export const downloadScratchVersion = (version: ScratchVersionView) =>
  downloadScratchAsset(`/scratch/work-versions/${version.id}/project`, version.project.fileName);
