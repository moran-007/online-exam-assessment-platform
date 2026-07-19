import { apiWire } from '../../api';

export type LessonAssetAudience = 'INTERNAL' | 'LEARNER';

export interface LessonAssetView {
  id: string;
  audience: LessonAssetAudience;
  title: string | null;
  note: string | null;
  sortOrder: number;
  fileName: string;
  mimeType: string | null;
  fileSize: string;
  sha256: string | null;
}

export interface LessonRecordView {
  id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'PUBLISHED';
  version: number;
  internalTeachingNotes?: string | null;
  internalClassPerformance?: string | null;
  publicTeachingContent: string | null;
  publicLearningGoal: string | null;
  publicClassPerformance: string | null;
  publicHomework: string | null;
  publicNextPlan: string | null;
  publicMaterials: string | null;
  submittedAt?: string | null;
  publishedAt: string | null;
  assets: LessonAssetView[];
}

export interface LessonRecordDetail {
  session: LessonSessionView;
  record: LessonRecordView | null;
}

export interface LessonRecordVersionView {
  id: string;
  version: number;
  action: string;
  status: LessonRecordView['status'];
  reason: string | null;
  createdAt: string;
}

export interface LessonSessionView {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  classGroup: { id: string; name: string };
  lessonType: { id: string; name: string };
}

export interface PortalStudent {
  id: string;
  username: string;
  realName: string | null;
  studentProfile: { studentNo: string | null; school: string | null; grade: string | null } | null;
  studentClasses: Array<{ classGroup: { id: string; name: string } }>;
}

export interface PortalStudentRelation {
  student: PortalStudent;
  relationship: string;
  isPrimary: boolean;
}

export interface PortalLesson extends LessonSessionView {
  record: LessonRecordView | null;
}

export interface PortalOverview {
  student: PortalStudent;
  lessons: { items: PortalLesson[]; total: number; page: number; pageSize: number };
  exams: Array<{ id: string; name: string; courseName: string; submittedAt: string; score: number | null }>;
  summaries: PortalSummary[];
}

export interface PortalSummary {
  id: string;
  type: string;
  content: unknown;
  publishedAt: string;
}

const data = async <T>(request: Promise<unknown>) => ((await request) as { data: T }).data;

export const getLessonRecord = (sessionId: string, studentId?: string) =>
  data<LessonRecordDetail>(apiWire(`/lesson-records/${sessionId}${studentId ? `?studentId=${encodeURIComponent(studentId)}` : ''}`));

export const saveLessonRecordDraft = (sessionId: string, body: Record<string, unknown>) =>
  data<LessonRecordDetail>(apiWire(`/lesson-records/${sessionId}/draft`, { method: 'PUT', body }));

export const submitLessonRecord = (sessionId: string, reason?: string) =>
  data<LessonRecordDetail>(apiWire(`/lesson-records/${sessionId}/submit`, { method: 'POST', body: { reason } }));

export const publishLessonRecord = (sessionId: string, reason?: string) =>
  data<LessonRecordDetail>(apiWire(`/lesson-records/${sessionId}/publish`, { method: 'POST', body: { reason } }));

export const listLessonRecordVersions = (sessionId: string) =>
  data<LessonRecordVersionView[]>(apiWire(`/lesson-records/${sessionId}/versions`));

export const uploadLessonAsset = (
  sessionId: string,
  file: File,
  metadata: { audience: LessonAssetAudience; title?: string; note?: string },
) => {
  const body = new FormData();
  body.append('file', file);
  body.append('audience', metadata.audience);
  if (metadata.title) body.append('title', metadata.title);
  if (metadata.note) body.append('note', metadata.note);
  return data<LessonAssetView>(apiWire(`/lesson-records/${sessionId}/assets`, { method: 'POST', body }));
};

export const removeLessonAsset = (sessionId: string, assetId: string) =>
  data<boolean>(apiWire(`/lesson-records/${sessionId}/assets/${assetId}`, { method: 'DELETE' }));

export async function openLessonAsset(
  sessionId: string,
  asset: LessonAssetView,
  options: { studentId?: string; download?: boolean } = {},
) {
  const params = new URLSearchParams({ action: options.download ? 'download' : 'preview' });
  if (options.studentId) params.set('studentId', options.studentId);
  const response = await apiWire(`/lesson-records/${sessionId}/assets/${asset.id}/content?${params.toString()}`);
  const sourceBlob = response.data as Blob;
  const previewBlob = textPreviewBlob(sourceBlob, asset.mimeType ?? sourceBlob.type);
  const url = URL.createObjectURL(options.download ? sourceBlob : previewBlob);
  if (options.download) {
    const link = document.createElement('a');
    link.href = url;
    link.download = asset.fileName;
    link.click();
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function textPreviewBlob(blob: Blob, mimeType: string) {
  if (!mimeType.toLowerCase().startsWith('text/')) return blob;
  const type = /;\s*charset=/i.test(blob.type) ? blob.type : `${mimeType}; charset=utf-8`;
  return new Blob(['\uFEFF', blob], { type });
}

export const listPortalStudents = () => data<PortalStudentRelation[]>(apiWire('/learning-portal/students'));
export const getPortalOverview = (studentId: string) => data<PortalOverview>(apiWire(`/learning-portal/students/${studentId}`));
