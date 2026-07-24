import type { TeachingProcessStage } from './useLessonPlanCatalog';
import { normalizeLessonPlanMarkdown } from './lessonPlanMarkdown';

export const LESSON_PLAN_SYSTEM_INSTRUCTION = [
  '你是教师资格考试与一线备课专家。',
  '仅返回符合字段契约的合法 JSON，不要解释或使用代码围栏。',
  '教师可配置的模板只影响课型、教学风格和内容详略，不得改变字段名称、数据类型与课时规则。',
  '教学过程必须可直接授课，教师活动与学生活动不可为空并逐项换行；环节时长总和必须等于总课时。',
  '公式使用 LaTeX；完整语句或示例代码必须另起带语言标识的 Markdown 围栏代码块，只有短标识符和运算符可使用行内代码。',
].join('');

export const LESSON_PLAN_STAGE_SYSTEM_INSTRUCTION = [
  '只生成当前教学环节并返回合法 JSON，不要解释或使用代码围栏。',
  '不得修改环节名称和时间。',
  '教师活动与学生活动必须具体、可直接执行并逐项换行；其他字段按需填写。',
  '教师配置只能影响教学风格和内容，不得改变字段契约。',
  '公式使用 LaTeX；完整语句或示例代码必须另起带语言标识的 Markdown 围栏代码块，只有短标识符和运算符可使用行内代码。',
].join('');

export const LESSON_PLAN_TIME_ALLOCATION_INSTRUCTION = [
  '你是课堂时间规划助手，只分配教学环节时间。',
  '仅返回合法 JSON：{"teachingProcess":[{"index":1,"title":"环节名称","duration":正整数}]}，不要解释或使用代码围栏。',
  'index 从 1 连续编号；必须保持环节数量、名称和顺序不变，所有 duration 之和严格等于总课时。',
].join('');

export const LESSON_PLAN_PROCESS_FIELDS = [
  'title', 'duration', 'coreQuestion', 'teacherActivity', 'studentActivity',
  'assessment', 'designIntent', 'resources',
].join(',');

export interface LessonPlanPromptContext {
  courseName: string;
  knowledgePointName: string;
  topic: string;
  gradeLevel: string;
  durationMinutes: number;
  templateName: string;
  templateContent: string;
  requirements: string;
  processBlueprint: Array<{ title: string; duration: number }>;
}

export interface TeachingProcessQualityIssue {
  stageId: string;
  stageTitle: string;
  message: string;
}

export function buildFullLessonPlanPrompt(context: LessonPlanPromptContext) {
  const processBlueprint = context.processBlueprint.length
    ? [
        '',
        '【教师指定的教学流程】',
        JSON.stringify(context.processBlueprint),
        '必须严格保持上述环节名称、顺序和 duration，不得新增、删除、合并或改名；只补充各环节教学内容。',
      ]
    : [];
  return [
    '【备课信息】',
    `课程：${context.courseName}`,
    `课程知识点：${context.knowledgePointName || '未指定'}`,
    `课题：${context.topic}`,
    `年级/对象：${context.gradeLevel || '请结合课程合理推定并在 gradeLevel 中明确填写'}`,
    `整节课总时长：${context.durationMinutes} 分钟`,
    ...processBlueprint,
    '',
    `【当前生成模板：${context.templateName}】`,
    context.templateContent,
    '',
    '【本次补充要求】',
    context.requirements || '无',
    '',
    '【系统固定的详细度底线】',
    '1. 教学目标要具体、可观察、可评价；教学重点与难点要明确指向本课内容。情感态度价值观和核心素养仅在确有教学价值时填写，可为空，禁止套话。',
    '2. teacherActivity 与 studentActivity 必须可直接执行，禁止只写“教师讲解”“学生思考”“完成练习”等空话。',
    '3. 1—2分钟环节的师生活动至少各1条；3—5分钟至少2条和1条；6—15分钟至少3条和2条；超过15分钟至少4条和3条。',
    '4. 每条活动单独一行并以序号或项目符号开头。教师活动写清具体教学内容、问题/指令、讲解或示范、巡视反馈和必要过渡；学生活动写清观察、操作、讨论、练习、展示及预期产出。',
    '5. 教师活动与学生活动要前后对应；主要环节应出现本学科的文本、公式、例题、实验步骤、图表或代码等真实教学载体。',
    '6. 程序示例、完整语句或多行代码必须另起 Markdown 围栏代码块并标注语言（如 ```cpp）；仅变量名、函数名和运算符等短内容可使用行内反引号。禁止把完整程序压成句子中的行内代码。',
    '7. coreQuestion、assessment、designIntent、resources 仅在确有需要时填写，可为空；不得为凑字段重复同一句话。',
    '8. 各环节 duration 必须为正整数，合计严格等于整节课总时长；环节名称和数量按课型合理决定。',
    '',
    '【JSON字段契约】',
    '根字段：gradeLevel,learnerAnalysis,knowledgeObjectives,processObjectives,valueObjectives,coreCompetencies,teachingContent,keyPoints,difficultPoints,doubtfulPoints,teachingMethods,teachingMeans,preparation,teachingProcess,homework,assessment,boardDesign,reflection。',
    `teachingProcess 每项字段：${LESSON_PLAN_PROCESS_FIELDS}。`,
    '除 duration 外均为字符串；字符串中的分点使用换行符，不要把多项内容挤成一个长段落。',
  ].join('\n');
}

export function buildStageLessonPlanPrompt(input: {
  context: LessonPlanPromptContext;
  stage: TeachingProcessStage;
  knowledgeObjectives: string;
  learnerAnalysis: string;
  teachingContent: string;
  keyPoints: string;
  difficultPoints: string;
  teachingMethods: string;
  adjacentStages: string;
  revisionRequest: string;
}) {
  const { context, stage } = input;
  const prompt = [
    '【备课信息】',
    `课程：${context.courseName}`,
    `知识点：${context.knowledgePointName || '未指定'}`,
    `课题：${context.topic}`,
    `年级/对象：${context.gradeLevel || '未指定'}`,
    `学情分析：${promptExcerpt(input.learnerAnalysis, 700) || '未填写'}`,
    `教学目标：${promptExcerpt(input.knowledgeObjectives, 800) || '未填写'}`,
    `教学内容：${promptExcerpt(input.teachingContent, 1_200) || '未填写'}`,
    `重点：${promptExcerpt(input.keyPoints, 500) || '未填写'}`,
    `难点：${promptExcerpt(input.difficultPoints, 500) || '未填写'}`,
    `教学方法：${promptExcerpt(input.teachingMethods, 500) || '未填写'}`,
    `相邻环节：${input.adjacentStages || '无'}`,
    '',
    `【当前环节】${stage.title}（${stage.duration}分钟）`,
    `原内容：${promptExcerpt(JSON.stringify(stage), 4_500)}`,
    '',
    `【当前生成模板：${context.templateName}】`,
    context.templateContent,
    '',
    `【本次补充要求】${promptExcerpt(context.requirements, 1_800) || '无'}`,
    `【本环节修改意见】${promptExcerpt(input.revisionRequest, 1_200)}`,
    '',
    '【输出要求】',
    '只返回字段 coreQuestion,teacherActivity,studentActivity,assessment,designIntent,resources。',
    '必须针对“本环节修改意见”完成修改，不得原样照抄原内容；保持当前环节名称和时长不变。',
    activityMinimumRule(stage.duration),
    '教师活动要写明具体内容、问题或指令、示范/讲解、反馈与过渡；学生活动要对应写明操作及预期产出。',
    '完整语句或示例代码必须另起带语言标识的 Markdown 围栏代码块；短变量名、函数名和运算符才使用行内反引号。',
    '各分点必须单独换行并以序号或项目符号开头。其他栏目按需填写，确无需要时可保留原内容。',
  ].join('\n');
  return promptExcerpt(prompt, 19_500);
}

export function buildTimeAllocationPrompt(input: {
  courseName: string;
  topic: string;
  gradeLevel: string;
  totalMinutes: number;
  stages: TeachingProcessStage[];
}) {
  const stageDigest = input.stages.map((stage, index) => ({
    index: index + 1,
    title: stage.title,
    currentDuration: stage.duration,
    content: promptExcerpt([
      stage.coreQuestion,
      stage.teacherActivity,
      stage.studentActivity,
    ].filter(Boolean).join('\n'), 900),
  }));
  return promptExcerpt([
    `课程：${input.courseName || '未指定'}`,
    `课题：${input.topic || '未指定'}`,
    `年级/对象：${input.gradeLevel || '未指定'}`,
    `总课时：${input.totalMinutes} 分钟`,
    '请根据各环节的教学作用、任务复杂度、活动数量和练习反馈需要合理分配时间。',
    '导入与总结通常保持紧凑，概念建构、探究、实验、示范和练习应获得与内容量匹配的时间；不得机械平均。',
    '环节（有效 JSON）：',
    JSON.stringify(stageDigest),
    '保持环节数量、名称和顺序不变；每项 duration 为正整数且合计严格等于总课时。',
  ].join('\n'), 19_500);
}

export function normalizeGeneratedTeachingProcess(stages: TeachingProcessStage[]) {
  return stages.map((stage) => ({
    ...stage,
    coreQuestion: normalizeGeneratedLessonPlanText(stage.coreQuestion),
    teacherActivity: normalizeGeneratedLessonPlanText(stage.teacherActivity),
    studentActivity: normalizeGeneratedLessonPlanText(stage.studentActivity),
    assessment: normalizeGeneratedLessonPlanText(stage.assessment),
    designIntent: normalizeGeneratedLessonPlanText(stage.designIntent),
    resources: normalizeGeneratedLessonPlanText(stage.resources),
  }));
}

export function normalizeGeneratedLessonPlanText(value: string) {
  return normalizeGeneratedBreaks(normalizeLessonPlanMarkdown(value));
}

export function validateDetailedTeachingProcess(
  stages: TeachingProcessStage[],
  totalMinutes?: number,
): TeachingProcessQualityIssue[] {
  const issues: TeachingProcessQualityIssue[] = [];
  if (typeof totalMinutes === 'number') {
    const allocated = stages.reduce((sum, stage) => sum + stage.duration, 0);
    if (allocated !== totalMinutes) {
      issues.push({
        stageId: '',
        stageTitle: '课时分配',
        message: `教学环节合计 ${allocated} 分钟，应为 ${totalMinutes} 分钟`,
      });
    }
  }
  stages.forEach((stage) => {
    validateActivity(issues, stage, 'teacherActivity', '教师活动', minimumStepCounts(stage.duration).teacher);
    validateActivity(issues, stage, 'studentActivity', '学生活动', minimumStepCounts(stage.duration).student);
  });
  return issues;
}

export function formatTeachingProcessIssues(issues: TeachingProcessQualityIssue[], limit = 3) {
  const summary = issues.slice(0, limit).map((issue) => `${issue.stageTitle}：${issue.message}`).join('；');
  return issues.length > limit ? `${summary}；另有 ${issues.length - limit} 项` : summary;
}

export function mergeGeneratedStage(
  stage: TeachingProcessStage,
  generated: Record<string, unknown>,
): TeachingProcessStage {
  const result = { ...stage };
  (['coreQuestion', 'teacherActivity', 'studentActivity', 'assessment', 'designIntent', 'resources'] as const)
    .forEach((key) => {
      const value = typeof generated[key] === 'string' ? normalizeGeneratedLessonPlanText(generated[key]) : '';
      if (value) result[key] = value;
    });
  return result;
}

export function repairTeachingProcessPrompt(input: {
  context: LessonPlanPromptContext;
  stages: TeachingProcessStage[];
  issues: TeachingProcessQualityIssue[];
}) {
  const repairAll = input.issues.some((issue) => !issue.stageId);
  const issueStageIds = new Set(input.issues.map((issue) => issue.stageId).filter(Boolean));
  const targets = repairAll ? input.stages : input.stages.filter((stage) => issueStageIds.has(stage.id));
  const stageCharacterBudget = Math.max(80, Math.floor(7_000 / Math.max(1, targets.length)) - 150);
  const stageSnapshot = JSON.stringify(targets.map((stage) => ({
    id: stage.id,
    title: stage.title,
    duration: stage.duration,
    teacherActivity: promptExcerpt(stage.teacherActivity, Math.ceil(stageCharacterBudget * 0.55)),
    studentActivity: promptExcerpt(stage.studentActivity, Math.floor(stageCharacterBudget * 0.45)),
  })));
  const prompt = [
    buildFullLessonPlanPrompt(input.context),
    '',
    '【自动质检结果】',
    promptExcerpt(formatTeachingProcessIssues(input.issues, 12), 1_200),
    repairAll
      ? '请修复课时分配并补足不合格活动，返回所列全部环节；保留每项 id 和 title，可调整 duration 使总和等于总课时。'
      : '只返回需要修复的所列环节；必须保留每项 id、title、duration，不要返回未列出的环节。',
    '输出格式仅为 {"teachingProcess":[...]}，不要返回其他根字段。',
    `待修复环节（有效 JSON）：${stageSnapshot}`,
  ].join('\n');
  return promptExcerpt(prompt, 19_500);
}

export function mergeRepairedTeachingProcess(
  original: TeachingProcessStage[],
  repaired: TeachingProcessStage[],
  issues: TeachingProcessQualityIssue[],
) {
  const allowDurationChanges = issues.some((issue) => !issue.stageId);
  return original.map((stage) => {
    const replacement = repaired.find((item) => item.id === stage.id)
      || repaired.find((item) => item.title === stage.title);
    if (!replacement) return stage;
    return {
      ...mergeGeneratedStage(stage, replacement as unknown as Record<string, unknown>),
      id: stage.id,
      title: stage.title,
      duration: allowDurationChanges ? replacement.duration : stage.duration,
    };
  });
}

export function alignGeneratedTeachingProcess(
  blueprint: TeachingProcessStage[],
  generated: TeachingProcessStage[],
) {
  return blueprint.map((stage, index) => {
    const replacement = generated[index];
    if (!replacement) return stage;
    return {
      ...mergeGeneratedStage(stage, replacement as unknown as Record<string, unknown>),
      id: stage.id,
      title: stage.title,
      duration: stage.duration,
    };
  });
}

function validateActivity(
  issues: TeachingProcessQualityIssue[],
  stage: TeachingProcessStage,
  field: 'teacherActivity' | 'studentActivity',
  label: string,
  minimumSteps: number,
) {
  const value = stage[field].trim();
  if (!value) {
    issues.push({ stageId: stage.id, stageTitle: stage.title, message: `${label}不能为空` });
    return;
  }
  const steps = activitySteps(value);
  if (steps.length < minimumSteps) {
    issues.push({
      stageId: stage.id,
      stageTitle: stage.title,
      message: `${label}至少 ${minimumSteps} 条且每条单独换行，当前仅识别到 ${steps.length} 条`,
    });
  }
  const minimumCharacters = minimumSteps * (field === 'teacherActivity' ? 12 : 10);
  if (plainLength(value) < minimumCharacters || steps.some(isGenericActivity)) {
    issues.push({
      stageId: stage.id,
      stageTitle: stage.title,
      message: `${label}需要写明具体内容、任务或问题、预期反应及反馈，不能使用笼统短句`,
    });
  }
}

function minimumStepCounts(duration: number) {
  if (duration <= 2) return { teacher: 1, student: 1 };
  if (duration <= 5) return { teacher: 2, student: 1 };
  if (duration <= 15) return { teacher: 3, student: 2 };
  return { teacher: 4, student: 3 };
}

function activityMinimumRule(duration: number) {
  const count = minimumStepCounts(duration);
  return `${duration}分钟环节的教师活动至少 ${count.teacher} 条、学生活动至少 ${count.student} 条。`;
}

function activitySteps(value: string) {
  let insideCodeBlock = false;
  const lines = normalizeGeneratedBreaks(value).split(/\n+/u).map((item) => item.trim()).filter((item) => {
    if (item.startsWith('```')) {
      insideCodeBlock = !insideCodeBlock;
      return false;
    }
    return !insideCodeBlock && Boolean(item);
  });
  const marked = lines.filter((item) =>
    /^(?:\d{1,2}[.、)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•])\s*/u.test(item));
  return marked.length ? marked : lines;
}

function normalizeGeneratedBreaks(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment, index) => {
      if (index % 2) return segment;
      return segment
        .replace(/([。；;：:])\s*(?=(?:\d{1,2}[.、)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•])\s*)/gu, '$1\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    })
    .join('')
    .trim();
}

function promptExcerpt(value: string, maximum: number) {
  const normalized = String(value || '').trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

function plainLength(value: string) {
  return value.replace(/[\s#>*_`~-]/g, '').length;
}

function isGenericActivity(value: string) {
  const normalized = value
    .replace(/^(?:\d{1,2}[.、)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•])\s*/u, '')
    .replace(/[。；;，,\s]/g, '');
  return /^(?:教师)?(?:讲解|提问|演示|巡视|总结)(?:相关|有关)?(?:知识|内容|问题)?$/u.test(normalized)
    || /^(?:学生)?(?:思考|讨论|回答|练习|听讲|观察|操作)$/u.test(normalized);
}
