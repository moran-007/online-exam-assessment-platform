import { ref } from 'vue';
import {
  createLessonPlan,
  listLessonPlans,
  removeLessonPlan,
  updateLessonPlan,
} from '../api';

export interface TeachingProcessStage {
  id: string;
  title: string;
  duration: number;
  coreQuestion: string;
  teacherActivity: string;
  studentActivity: string;
  assessment: string;
  designIntent: string;
  resources: string;
}

export type LessonPlanSource = 'SYSTEM' | 'PERSONAL';

export interface LessonPlan {
  id: string;
  source: LessonPlanSource;
  authorId: string;
  authorName: string;
  courseId: string;
  knowledgePointId?: string;
  knowledgePointName?: string;
  theme: string;
  scheduledAt: string;
  classroom: string;
  instructorName: string;
  gradeLevel: string;
  durationMinutes: number;
  learnerAnalysis: string;
  knowledgeObjectives: string;
  processObjectives: string;
  valueObjectives: string;
  coreCompetencies: string;
  keyPoints: string;
  difficultPoints: string;
  doubtfulPoints: string;
  teachingContent: string;
  teachingMethods: string;
  teachingMeans: string;
  preparation: string;
  teachingProcess: TeachingProcessStage[];
  homework: string;
  assessment: string;
  boardDesign: string;
  reflection: string;
  createdAt: string;
  updatedAt: string;
}

export type LessonPlanEditable = Omit<
  LessonPlan,
  'id' | 'createdAt' | 'updatedAt' | 'knowledgePointName'
>;

const LEGACY_STORAGE_KEY = 'course-preset-lesson-plans-v1';

export function emptyLessonPlan(): LessonPlanEditable {
  return {
    source: 'PERSONAL',
    authorId: '',
    authorName: '',
    courseId: '',
    knowledgePointId: undefined,
    theme: '',
    scheduledAt: '',
    classroom: '',
    instructorName: '',
    gradeLevel: '',
    durationMinutes: 45,
    learnerAnalysis: '',
    knowledgeObjectives: '',
    processObjectives: '',
    valueObjectives: '',
    coreCompetencies: '',
    keyPoints: '',
    difficultPoints: '',
    doubtfulPoints: '',
    teachingContent: '',
    teachingMethods: '',
    teachingMeans: '',
    preparation: '',
    teachingProcess: [],
    homework: '',
    assessment: '',
    boardDesign: '',
    reflection: '',
  };
}

export function createTeachingProcessStage(
  value: Partial<Omit<TeachingProcessStage, 'id'>> & { title?: string } = {},
): TeachingProcessStage {
  return {
    id: makeId(),
    title: stageTitle(value.title) || '新教学环节',
    duration: positiveInteger(value.duration, 5),
    coreQuestion: text(value.coreQuestion),
    teacherActivity: text(value.teacherActivity),
    studentActivity: text(value.studentActivity),
    assessment: text(value.assessment),
    designIntent: text(value.designIntent),
    resources: text(value.resources),
  };
}

export function createSuggestedTeachingProcess(): TeachingProcessStage[] {
  return [
    createTeachingProcessStage({ title: '导入新课', duration: 5 }),
    createTeachingProcessStage({ title: '新知探究', duration: 12 }),
    createTeachingProcessStage({ title: '巩固练习', duration: 10 }),
    createTeachingProcessStage({ title: '迁移应用', duration: 8 }),
    createTeachingProcessStage({ title: '课堂总结', duration: 5 }),
    createTeachingProcessStage({ title: '出口检测', duration: 5 }),
  ];
}

export function normalizeTeachingProcess(value: unknown): TeachingProcessStage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      id: text(item.id) || makeId(),
      title: stageTitle(item.title) || '未命名环节',
      duration: positiveInteger(item.duration, 5),
      coreQuestion: text(item.coreQuestion),
      teacherActivity: text(item.teacherActivity),
      studentActivity: text(item.studentActivity),
      assessment: text(item.assessment),
      designIntent: text(item.designIntent),
      resources: text(item.resources),
    }));
}

export function teachingProcessDuration(stages: TeachingProcessStage[]) {
  return stages.reduce((total, stage) => total + positiveInteger(stage.duration, 0), 0);
}

export function isLessonPlanReady(plan: LessonPlan) {
  return [
    plan.theme,
    plan.knowledgeObjectives,
    plan.teachingContent,
    plan.keyPoints,
    plan.difficultPoints,
  ].every((value) => value.trim())
    && plan.teachingProcess.length > 0
    && plan.teachingProcess.every((stage) => stage.title.trim()
      && stage.duration > 0
      && stage.teacherActivity.trim()
      && stage.studentActivity.trim())
    && teachingProcessDuration(plan.teachingProcess) === plan.durationMinutes;
}

export function useLessonPlanCatalog() {
  const plans = ref<LessonPlan[]>([]);
  let loaded = false;
  let loadPromise: Promise<void> | null = null;

  async function load(force = false) {
    if (loaded && !force) return;
    if (loadPromise && !force) return loadPromise;
    loadPromise = (async () => {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_STORAGE_KEY);
      const value = await listLessonPlans();
      plans.value = value.map(readCurrentPlan).filter((item): item is LessonPlan => Boolean(item));
      loaded = true;
    })();
    try {
      await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  async function save(value: LessonPlanEditable, id?: string) {
    const { authorId: _authorId, authorName: _authorName, ...editable } = value;
    const payload = {
      ...editable,
      knowledgePointId: editable.knowledgePointId || undefined,
      teachingProcess: normalizeTeachingProcess(editable.teachingProcess),
    } as unknown as Record<string, unknown>;
    const response = id ? await updateLessonPlan(id, payload) : await createLessonPlan(payload);
    const plan = readCurrentPlan(response);
    if (!plan) throw new Error('服务端返回的教案结构无效');
    plans.value = id ? plans.value.map((item) => item.id === id ? plan : item) : [plan, ...plans.value];
    return plan;
  }

  async function remove(id: string) {
    await removeLessonPlan(id);
    plans.value = plans.value.filter((item) => item.id !== id);
  }

  return { plans, load, save, remove };
}

export function lessonPlanSearchText(plan: LessonPlan) {
  return JSON.stringify(plan).toLowerCase();
}

function readCurrentPlan(value: unknown): LessonPlan | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.id !== 'string'
    || typeof source.courseId !== 'string'
    || !isLessonPlanSource(source.source)
    || !text(source.authorId)
    || !text(source.authorName)
    || !Array.isArray(source.teachingProcess)
  ) return null;
  const base = emptyLessonPlan();
  const teachingProcess = normalizeTeachingProcess(source.teachingProcess);
  return {
    ...base,
    ...Object.fromEntries(Object.keys(base).map((key) => [key, key === 'durationMinutes'
      ? positiveNumber(source[key], base.durationMinutes)
      : key === 'teachingProcess'
        ? teachingProcess
        : text(source[key]) || base[key as keyof LessonPlanEditable]])),
    id: source.id,
    source: source.source,
    authorId: text(source.authorId),
    authorName: text(source.authorName),
    courseId: text(source.courseId),
    knowledgePointId: text(source.knowledgePointId) || undefined,
    knowledgePointName: text(source.knowledgePointName) || undefined,
    theme: text(source.theme),
    teachingProcess,
    createdAt: text(source.createdAt) || text(source.updatedAt) || new Date().toISOString(),
    updatedAt: text(source.updatedAt) || new Date().toISOString(),
  } as LessonPlan;
}

function isLessonPlanSource(value: unknown): value is LessonPlanSource {
  return value === 'SYSTEM' || value === 'PERSONAL';
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stageTitle(value: unknown) {
  return text(value).replace(/\s*[（(]\s*\d+\s*分钟\s*[)）]\s*$/u, '').trim();
}

function positiveNumber(value: unknown, fallback: number) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : fallback;
}

function positiveInteger(value: unknown, fallback: number) {
  const result = Math.floor(Number(value));
  return Number.isFinite(result) && result > 0 ? result : fallback;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `stage-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
