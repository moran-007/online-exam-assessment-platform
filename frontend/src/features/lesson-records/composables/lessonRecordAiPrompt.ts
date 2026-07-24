import type { LessonPlan, TeachingProcessStage } from './useLessonPlanCatalog';

/**
 * /ai/summary currently accepts at most 20,000 characters. Keep headroom for
 * future wrapper text added by the caller or transport without losing the
 * lesson-process outline.
 */
export const LESSON_RECORD_AI_CONTENT_SAFE_BUDGET = 18_000;
const LESSON_PLAN_DIGEST_BUDGET = 9_500;
const TRUNCATION_MARKER = '\n…（内容已按 AI 输入上限截断）';

interface LessonRecordAiPromptInput {
  plan: LessonPlan;
  sessionTitle?: string;
  actualTeachingNotes?: string;
  classPerformance?: string;
}

interface LabeledText {
  label: string;
  value: string;
}

/**
 * Builds the complete content sent to /ai/summary for a post-class record.
 * The output is deterministic and always stays below the public API limit.
 */
export function buildLessonRecordAiPromptContent(
  input: LessonRecordAiPromptInput,
  budget = LESSON_RECORD_AI_CONTENT_SAFE_BUDGET,
): string {
  const safeBudget = positiveBudget(budget);
  const sessionTitle = truncateText(compactText(input.sessionTitle || input.plan.theme), 300);
  const planDigest = buildLessonPlanDigest(input.plan, Math.min(LESSON_PLAN_DIGEST_BUDGET, safeBudget));
  const prefix = [
    `课次：${sessionTitle || '未填写'}`,
    '预设教案（教学过程核心摘录）：',
    planDigest,
  ].join('\n');
  const actualFields = [
    { label: '实际上课记录', value: compactText(input.actualTeachingNotes) || '未填写' },
    { label: '真实课堂表现', value: compactText(input.classPerformance) || '未填写' },
  ];
  const separatorLength = prefix ? 1 : 0;
  const actualBudget = Math.max(0, safeBudget - prefix.length - separatorLength);
  const actualText = buildLabeledText(actualFields, actualBudget);
  return truncateText([prefix, actualText].filter(Boolean).join('\n'), safeBudget);
}

export function buildLessonPlanDigest(plan: LessonPlan, budget = LESSON_PLAN_DIGEST_BUDGET): string {
  const safeBudget = positiveBudget(budget);
  const identity = buildLabeledText([
    { label: '教案来源', value: plan.source === 'PERSONAL' ? '教师个人教案' : '系统通用教案' },
    { label: '署名/上传者', value: compactText(plan.authorName) || '未署名' },
    { label: '课题', value: compactText(plan.theme) || '未填写' },
    { label: '授课教师', value: compactText(plan.instructorName) || '未填写' },
    { label: '教学对象', value: compactText(plan.gradeLevel) || '未填写' },
    { label: '总课时', value: `${positiveNumber(plan.durationMinutes)}分钟` },
    { label: '上课时间', value: compactText(plan.scheduledAt) || '未填写' },
    { label: '上课地点', value: compactText(plan.classroom) || '未填写' },
  ], Math.min(1_600, safeBudget));

  const remainingAfterIdentity = Math.max(0, safeBudget - identity.length - 1);
  const processBudget = Math.floor(remainingAfterIdentity * 0.68);
  const process = buildTeachingProcessDigest(plan.teachingProcess, processBudget);
  const summaryBudget = Math.max(0, remainingAfterIdentity - process.length - (process ? 1 : 0));
  const summary = buildLabeledText([
    { label: '教学内容', value: compactText(plan.teachingContent) },
    { label: '知识与技能目标', value: compactText(plan.knowledgeObjectives) },
    { label: '过程与方法目标', value: compactText(plan.processObjectives) },
    { label: '教学重点', value: compactText(plan.keyPoints) },
    { label: '教学难点', value: compactText(plan.difficultPoints) },
    { label: '疑点', value: compactText(plan.doubtfulPoints) },
    { label: '教学方法', value: compactText(plan.teachingMethods) },
    {
      label: '教学手段与准备',
      value: [compactText(plan.teachingMeans), compactText(plan.preparation)].filter(Boolean).join('\n'),
    },
    { label: '作业', value: compactText(plan.homework) },
    { label: '整体评价', value: compactText(plan.assessment) },
  ], summaryBudget);

  return truncateText([identity, process, summary].filter(Boolean).join('\n'), safeBudget);
}

function buildTeachingProcessDigest(stages: TeachingProcessStage[], budget: number): string {
  if (!stages.length || budget <= 0) return '';
  const safeStages = stages.slice(0, 30);
  const titleCap = Math.max(24, Math.min(80, Math.floor(budget / Math.max(1, safeStages.length)) - 18));
  const stageTitles = safeStages.map((stage, index) => (
    `${index + 1}. ${truncateText(compactText(stage.title) || '未命名环节', titleCap)}（${positiveNumber(stage.duration)}分钟）`
  ));

  const essentialEntries = safeStages.flatMap((stage, stageIndex) => [
    { stageIndex, label: '核心问题', value: compactText(stage.coreQuestion) },
    { stageIndex, label: '教师活动', value: compactText(stage.teacherActivity) },
    { stageIndex, label: '学生活动', value: compactText(stage.studentActivity) },
  ]).filter((item) => item.value);
  const optionalEntries = safeStages.flatMap((stage, stageIndex) => [
    { stageIndex, label: '评价', value: compactText(stage.assessment) },
    { stageIndex, label: '资源', value: compactText(stage.resources) },
  ]).filter((item) => item.value);

  const heading = '教学过程：';
  let entries = essentialEntries;
  let skeleton = composeTeachingProcess(heading, stageTitles, entries, []);
  for (const entry of optionalEntries) {
    const candidate = [...entries, entry];
    const candidateSkeleton = composeTeachingProcess(heading, stageTitles, candidate, []);
    if (candidateSkeleton.length > budget) break;
    entries = candidate;
    skeleton = candidateSkeleton;
  }
  if (skeleton.length > budget) {
    entries = entries.filter((entry) => entry.label !== '核心问题');
    skeleton = composeTeachingProcess(heading, stageTitles, entries, []);
  }
  if (skeleton.length > budget) {
    entries = [];
    skeleton = composeTeachingProcess(heading, stageTitles, entries, []);
  }

  const valueBudget = Math.max(0, budget - skeleton.length);
  const caps = allocateValueCaps(entries.map((entry) => entry.value), valueBudget);
  return truncateText(composeTeachingProcess(heading, stageTitles, entries, caps), budget);
}

function composeTeachingProcess(
  heading: string,
  stageTitles: string[],
  entries: Array<{ stageIndex: number; label: string; value: string }>,
  caps: number[],
): string {
  const byStage = new Map<number, string[]>();
  entries.forEach((entry, index) => {
    const value = caps.length ? truncateText(entry.value, caps[index] || 0) : '';
    const lines = byStage.get(entry.stageIndex) || [];
    lines.push(`${entry.label}：${value}`);
    byStage.set(entry.stageIndex, lines);
  });
  return [
    heading,
    ...stageTitles.flatMap((title, index) => [title, ...(byStage.get(index) || [])]),
  ].join('\n');
}

function buildLabeledText(fields: LabeledText[], budget: number): string {
  if (budget <= 0) return '';
  const active = fields
    .map((field) => ({ label: compactText(field.label), value: compactText(field.value) }))
    .filter((field) => field.label && field.value);
  if (!active.length) return '';

  const overhead = active.reduce((total, field, index) => (
    total + field.label.length + 1 + (index ? 1 : 0)
  ), 0);
  if (overhead >= budget) {
    return truncateText(active.map((field) => `${field.label}：`).join('\n'), budget);
  }
  const caps = allocateValueCaps(active.map((field) => field.value), budget - overhead);
  return active
    .map((field, index) => `${field.label}：${truncateText(field.value, caps[index] || 0)}`)
    .join('\n');
}

/**
 * Water-fill short values first, then share the remaining characters equally.
 * This avoids wasting a field's unused allowance and produces stable results.
 */
function allocateValueCaps(values: string[], budget: number): number[] {
  const caps = Array(values.length).fill(0) as number[];
  let remaining = Math.max(0, budget);
  let unresolved = values.map((_, index) => index);
  while (unresolved.length && remaining > 0) {
    const share = Math.floor(remaining / unresolved.length);
    if (share <= 0) {
      unresolved.slice(0, remaining).forEach((index) => { caps[index] += 1; });
      break;
    }
    const completed = unresolved.filter((index) => values[index].length <= share);
    if (!completed.length) {
      unresolved.forEach((index, order) => {
        caps[index] = share + (order < remaining % unresolved.length ? 1 : 0);
      });
      break;
    }
    completed.forEach((index) => {
      caps[index] = values[index].length;
      remaining -= values[index].length;
    });
    unresolved = unresolved.filter((index) => !completed.includes(index));
  }
  return caps;
}

function compactText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(value: string, limit: number): string {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (value.length <= safeLimit) return value;
  if (safeLimit <= TRUNCATION_MARKER.length) return safeSlice(value, safeLimit);
  return `${safeSlice(value, safeLimit - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}

function safeSlice(value: string, length: number): string {
  let result = value.slice(0, Math.max(0, length));
  if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1);
  return result;
}

function positiveNumber(value: unknown): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function positiveBudget(value: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
