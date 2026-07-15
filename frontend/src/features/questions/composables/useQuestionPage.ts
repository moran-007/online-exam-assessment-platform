/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- migrated page state is isolated here while domain models are typed incrementally.
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Check,
  Close,
  Delete,
  Download,
  DocumentAdd,
  DocumentCopy,
  Edit,
  Hide,
  Link,
  MoreFilled,
  Plus,
  Refresh,
  Search,
  Upload,
  View,
} from '@element-plus/icons-vue';
import {
  bulkDeleteQuestions as bulkDeleteQuestionsRequest,
  bulkUpdateQuestionStatus as bulkUpdateQuestionStatusRequest,
  checkQuestionAnswer,
  createQuestion,
  createQuestionTag,
  getKnowledgePointTree,
  getQuestion,
  getQuestionDeleteImpact,
  listQuestionCourses,
  listQuestions,
  listQuestionTags,
  publishQuestion,
  removeQuestion as removeQuestionRequest,
  updateQuestion,
} from '../api';
import {
  listHydroPlatforms,
  listMyHydroAccounts,
  pullHydroProblem as fetchHydroProblem,
  submitHydroPracticeCode,
} from '../../hydro/api';
import { createExportTask } from '../../exports/api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import { useQuestionTypeOptions } from '../composables/useQuestionTypeOptions';
import {
  buildFillBlankAnswer,
  emptyFillBlankRows,
  fillBlankAnswerTextFromRows,
  fillBlankAnswerTextFromRules,
  fillBlankRowsFromText,
} from '../../../utils/fillBlankAnswers';

export function useQuestionPage(): any {
const router = useRouter();
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const { typeOptions } = useQuestionTypeOptions();
const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '待审核', value: 'pending_review' },
  { label: '已公开', value: 'published' },
  { label: '已隐藏', value: 'disabled' },
];
const statusSegmentOptions = statusOptions.map((item) => ({ label: item.label, value: item.value }));

const courses = ref([]);
const tags = ref([]);
const formKnowledgeTree = ref([]);
const filterKnowledgeTree = ref([]);
const items = ref([]);
const materialCandidates = ref([]);
const blankAnswerRows = ref(emptyFillBlankRows());
const blankAnswerText = computed({
  get: () => fillBlankAnswerTextFromRows(blankAnswerRows.value),
  set: (value) => {
    blankAnswerRows.value = fillBlankRowsFromText(value);
  },
});
const answerReference = ref('');
const previewVisible = ref(true);
const entryMode = ref('single');
const saving = ref(false);
const hydroPulling = ref(false);
const editingId = ref('');
const editMode = ref(false);
const editorVisible = ref(false);
const selectedQuestionRows = ref([]);
const questionScope = ref('published');
const filter = reactive({
  courseId: '',
  knowledgePointId: '',
  tagId: '',
  type: '',
  keyword: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const bulkQuestionStatus = ref('');
const questionExportVisible = ref(false);
const pendingExportQuestionIds = ref([]);
const hydroAccounts = ref([]);
const hydroPlatforms = ref([]);
const questionExportOptions = reactive({
  format: 'zip',
  includeAnswers: true,
  includeAnalysis: true,
});
const form = reactive(baseForm());
const practiceVisible = ref(false);
const practiceDetail = ref(null);
const practiceResult = ref(null);
const practiceProgrammingResult = ref(null);
const practiceProgrammingSubmitLoading = ref(false);
const practiceHydroAccountId = ref('');
const answerLayout = ref('side');
const practiceAnswer = reactive(emptyPracticeAnswer());
const practiceChildAnswers = reactive({});
const practiceChildResults = reactive({});

const isEditing = computed(() => Boolean(editingId.value));
const isChoice = computed(() => isChoiceType(form.type));
const quickTags = computed(() => tags.value.slice(0, 3));
const formKnowledgeTreeOptions = computed(() => convertKnowledgeTree(formKnowledgeTree.value));
const filterKnowledgeTreeOptions = computed(() => convertKnowledgeTree(filterKnowledgeTree.value));
const editorTitle = computed(() => (isEditing.value ? '编辑题目 / 复制题目' : '题目编辑'));
const selectedQuestionIds = computed(() => selectedQuestionRows.value.map((row) => row.id));
const practiceDialogWidth = computed(() => (answerLayout.value === 'side' ? '1180px' : '860px'));
const practiceMatchedHydroAccounts = computed(() => matchedHydroAccountsFor(practiceDetail.value));
const canPullHydroProblem = computed(() =>
  Boolean(form.programmingRef.externalProblemId?.trim() || form.programmingRef.externalProblemUrl?.trim()),
);
const hydroProblemUrl = computed(() => {
  const explicit = effectiveHydroProblemUrl(form.programmingRef);
  const problemId = form.programmingRef.externalProblemId?.trim();
  if (explicit) return explicit;
  const baseUrl = normalizeBaseUrl(form.programmingRef.platformBaseUrl || 'https://oj.example.com');
  const domainId = form.programmingRef.domainId?.trim();
  const domainPrefix = domainId && domainId !== 'system' ? `/d/${encodeURIComponent(domainId)}` : '';
  return problemId ? `${baseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}` : '';
});
const hydroAccountOptions = computed(() =>
  matchingHydroAccountsForRef(form.programmingRef).map((account) => ({
    ...account,
    label: `${account.loginUsername || account.hydroUsername || '外部账号'} · ${account.platformName || account.platformCode || 'Hydro'} · ${shortHost(account.platformBaseUrl)}`,
  })),
);
const hydroSiteOptions = computed(() => {
  const map = new Map();
  const pushSite = (site) => {
    const value = normalizeBaseUrl(site.value || site.baseUrl || site.platformBaseUrl);
    const host = canonicalHost(value);
    if (!host || map.has(host)) return;
    map.set(host, {
      key: host,
      value,
      judgeProvider: site.judgeProvider || site.code || site.platformCode || 'hydro',
      label: `${site.name || site.platformName || '外部平台'} (${shortHost(value)})`,
    });
  };
  hydroPlatforms.value.forEach((platform) => pushSite(platform));
  hydroAccounts.value.forEach((account) =>
    pushSite({
      value: account.platformBaseUrl,
      platformCode: account.platformCode,
      platformName: account.platformName,
    }),
  );
  return [...map.values()];
});
const selectedHydroAccount = computed(() =>
  hydroAccounts.value.find((account) => account.id === form.programmingRef.accountId) ?? null,
);
const hydroBindingLabel = computed(() => {
  const parts = [
    form.programmingRef.platformBaseUrl,
    `域 ${formatHydroDomainLabel(form.programmingRef)}`,
    form.programmingRef.accountLabel || selectedHydroAccount.value?.loginUsername,
  ].filter(Boolean);
  return parts.join(' / ');
});

function formatHydroDomainLabel(ref) {
  const domainId = String(ref?.domainId || '').trim();
  const domainName = String(ref?.domainName || '').trim();
  if (domainId && domainName && domainName !== domainId && domainName !== 'system') {
    return `${domainId} / ${domainName}`;
  }
  return domainId || domainName || 'system';
}

function languageOptionsFor(question) {
  const languages = question?.programmingRef?.languages || [];
  return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
}

function languageLabel(language) {
  const labels = {
    'cc.cc17o2': 'C++17(O2)',
    'cc.cc17': 'C++17',
    'cc.cc14o2': 'C++14(O2)',
    'cc.cc14': 'C++14',
    'cc.cc11o2': 'C++11(O2)',
    'cc.cc11': 'C++11',
    'py.py3': 'Python 3',
    'py.py2': 'Python 2',
    'cc.cc20o2': 'C++20(O2)',
    'cc.cc20': 'C++20',
    cpp17: 'C++17',
    python3: 'Python 3',
    java: 'Java',
    c: 'C',
    cc: 'C++',
    pas: 'Pascal',
  };
  return labels[language] ?? language;
}

function programmingFeedbackType(result) {
  if (!isProgrammingFinal(result)) return 'info';
  return isFullProgrammingScore(result) ? 'success' : 'error';
}

function programmingFeedbackTitle(result) {
  if (!isProgrammingFinal(result)) return '等待 Hydro 评测';
  return isFullProgrammingScore(result) ? '全部测试点通过' : '部分测试点未通过';
}

function isProgrammingFinal(result) {
  return Boolean(result) && !['pending', 'judging'].includes(result.status);
}

function isFullProgrammingScore(result) {
  const passed = Number(result?.passedTestCaseCount);
  const total = Number(result?.totalTestCaseCount);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(passed)) return passed === total;
  const rate = Number(result?.scoreRate);
  if (Number.isFinite(rate)) return rate >= 1;
  const score = Number(result?.score);
  const maxScore = Number(result?.maxScore);
  if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) return score >= maxScore;
  if (result?.isCorrect === true) return true;
  if (result?.isCorrect === false) return false;
  return result?.status === 'accepted';
}

const correctChoiceKey = computed({
  get() {
    return form.options.find((option) => option.isCorrect)?.optionKey ?? '';
  },
  set(value) {
    form.options.forEach((option) => {
      option.isCorrect = option.optionKey === value;
    });
  },
});

function baseForm() {
  return {
    courseId: '',
    type: 'single_choice',
    status: 'draft',
    title: '',
    knowledgePointIds: [],
    tagNames: [],
    content: '',
    difficulty: 1,
    defaultScore: 2,
    analysis: '',
    programmingRef: emptyProgrammingRef(),
    children: [],
    options: [
      { optionKey: 'A', content: '', isCorrect: false, sortOrder: 1 },
      { optionKey: 'B', content: '', isCorrect: true, sortOrder: 2 },
      { optionKey: 'C', content: '', isCorrect: false, sortOrder: 3 },
      { optionKey: 'D', content: '', isCorrect: false, sortOrder: 4 },
    ],
  };
}

function emptyProgrammingRef() {
  return {
    externalProblemId: '',
    externalProblemUrl: '',
    platformBaseUrl: 'https://oj.example.com',
    domainId: 'system',
    domainName: 'system',
    judgeProvider: 'hydro',
    accountId: '',
    accountLabel: '',
    languagesText: 'cc.cc17o2, py.py3',
    timeLimit: null,
    memoryLimit: null,
    judgeConfig: null,
  };
}

async function loadCourses() {
  const data = await listQuestionCourses();
  courses.value = data.items;
  if (!form.courseId) form.courseId = courses.value[0]?.id ?? '';
  await loadFormKnowledgeTree();
  await loadFilterKnowledgeTree();
}

async function loadHydroAccounts() {
  try {
    const data = await listMyHydroAccounts();
    hydroAccounts.value = data.items ?? data ?? [];
    syncHydroAccountForSite();
  } catch {
    hydroAccounts.value = [];
  }
}

async function loadHydroPlatforms() {
  try {
    hydroPlatforms.value = await listHydroPlatforms();
  } catch {
    hydroPlatforms.value = [];
  }
}

function handleHydroAccountChange(accountId) {
  const account = hydroAccounts.value.find((item) => item.id === accountId);
  if (!account) {
    form.programmingRef.accountLabel = '';
    return;
  }
  form.programmingRef.platformBaseUrl = account.platformBaseUrl || form.programmingRef.platformBaseUrl;
  form.programmingRef.judgeProvider = account.platformCode || form.programmingRef.judgeProvider || 'hydro';
  form.programmingRef.accountLabel = `${account.loginUsername || account.hydroUsername}@${shortHost(account.platformBaseUrl)}`;
}

function handleHydroSiteChange(value) {
  applyHydroSiteToRef(form.programmingRef, value);
  if (form.programmingRef.externalProblemUrl && value && !sameHydroBaseUrl(form.programmingRef.externalProblemUrl, value)) {
    form.programmingRef.externalProblemUrl = '';
  }
  syncHydroAccountForSite();
}

function handleHydroProblemInputChange() {
  normalizeHydroProblemInput(form.programmingRef);
  syncHydroAccountForSite();
}

function normalizeHydroProblemInput(ref) {
  const raw = String(ref.externalProblemId || '').trim();
  if (!raw) {
    ref.externalProblemUrl = '';
    return;
  }
  const parsed = parseHydroProblemUrl(raw);
  if (parsed) {
    ref.externalProblemId = parsed.problemId || raw;
    ref.externalProblemUrl = parsed.url;
    applyHydroSiteToRef(ref, parsed.baseUrl);
    if (parsed.domainId) {
      ref.domainId = parsed.domainId;
      ref.domainName = parsed.domainId;
    }
    return;
  }

  ref.externalProblemId = cleanHydroProblemId(raw);
  const explicitProblemId = problemIdFromHydroUrl(ref.externalProblemUrl);
  if (explicitProblemId && explicitProblemId !== ref.externalProblemId) {
    ref.externalProblemUrl = '';
  }
}

function applyHydroSiteToRef(ref, value) {
  const normalized = normalizeBaseUrl(value || ref.platformBaseUrl);
  const site = hydroSiteOptions.value.find((item) => sameHydroBaseUrl(item.value, normalized));
  ref.platformBaseUrl = site?.value || normalized;
  ref.judgeProvider = site?.judgeProvider || matchingHydroAccountForSite(ref.platformBaseUrl)?.platformCode || ref.judgeProvider || 'hydro';
}

function syncHydroAccountForSite() {
  const account = selectedHydroAccount.value;
  if (account && sameHydroBaseUrl(account.platformBaseUrl, form.programmingRef.platformBaseUrl)) {
    handleHydroAccountChange(account.id);
    return;
  }
  const nextAccount = matchingHydroAccountForSite(form.programmingRef.platformBaseUrl);
  form.programmingRef.accountId = nextAccount?.id || '';
  form.programmingRef.accountLabel = nextAccount
    ? `${nextAccount.loginUsername || nextAccount.hydroUsername}@${shortHost(nextAccount.platformBaseUrl)}`
    : '';
  if (nextAccount?.platformCode) {
    form.programmingRef.judgeProvider = nextAccount.platformCode;
  }
}

function matchingHydroAccountForSite(baseUrl) {
  return hydroAccounts.value.find((account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, baseUrl))
    || hydroAccounts.value.find((account) => sameHydroBaseUrl(account.platformBaseUrl, baseUrl))
    || null;
}

watch(
  () => form.programmingRef.platformBaseUrl,
  (value) => {
    const account = selectedHydroAccount.value;
    if (account && value && !sameHydroBaseUrl(account.platformBaseUrl, value)) {
      form.programmingRef.accountId = '';
      form.programmingRef.accountLabel = '';
    }
  },
);

watch(
  () => form.programmingRef.externalProblemId,
  (value) => {
    const raw = String(value || '').trim();
    if (!raw || parseHydroProblemUrl(raw)) return;
    const currentProblemId = cleanHydroProblemId(raw);
    const explicitProblemId = problemIdFromHydroUrl(form.programmingRef.externalProblemUrl);
    if (explicitProblemId && explicitProblemId !== currentProblemId) {
      form.programmingRef.externalProblemUrl = '';
    }
  },
);

async function loadFormKnowledgeTree() {
  formKnowledgeTree.value = form.courseId ? await getKnowledgePointTree(form.courseId) : [];
}

async function loadFilterKnowledgeTree() {
  filterKnowledgeTree.value = filter.courseId ? await getKnowledgePointTree(filter.courseId) : [];
}

async function handleFormCourseChange() {
  form.knowledgePointIds = [];
  form.children = [];
  await loadFormKnowledgeTree();
  if (form.type === 'material') await loadMaterialCandidates();
}

async function loadMaterialCandidates() {
  if (!form.courseId) {
    materialCandidates.value = [];
    return;
  }
  const data = await listQuestions({
      page: 1,
      pageSize: 200,
      courseId: form.courseId,
      scope: 'published',
      includeChildItems: true,
    });
  materialCandidates.value = (data.items ?? []).filter((item) => item.type !== 'material' && item.id !== editingId.value);
}

function addMaterialChild() {
  const used = new Set(form.children.map((child) => child.questionId));
  const candidate = materialCandidates.value.find((item) => !used.has(item.id));
  form.children.push({
    questionId: candidate?.id || '',
    score: Number(candidate?.defaultScore || 1),
    sortOrder: form.children.length + 1,
  });
}

function removeMaterialChild(index) {
  form.children.splice(index, 1);
}

function isMaterialCandidateDisabled(candidateId, currentIndex) {
  return form.children.some(
    (item, childIndex) => childIndex !== Number(currentIndex) && item.questionId === candidateId,
  );
}

async function handleFilterCourseChange() {
  filter.knowledgePointId = '';
  await loadFilterKnowledgeTree();
  await loadFirstPage();
}

async function loadTags() {
  const data = await listQuestionTags();
  tags.value = data.items;
}

async function load() {
  const data = await listQuestions({
      page: pagination.page,
      pageSize: pagination.pageSize,
      courseId: filter.courseId || undefined,
      tagId: filter.tagId || undefined,
      knowledgePointId: filter.knowledgePointId || undefined,
      scope: questionScope.value,
      type: filter.type || undefined,
      keyword: filter.keyword || undefined,
      sortBy: filter.sortBy,
      sortOrder: filter.sortOrder,
    });
  items.value = data.items;
  pagination.page = data.page;
  pagination.pageSize = data.pageSize;
  pagination.total = data.total;
}

async function refreshAll() {
  await Promise.all([loadTags(), load()]);
}

function loadFirstPage() {
  pagination.page = 1;
  return load();
}

function handleQuestionSortChange({ prop, order }) {
  filter.sortBy = prop || 'createdAt';
  filter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  return loadFirstPage();
}

async function filterByTag(tag) {
  filter.tagId = tag.id;
  await loadFirstPage();
}

async function filterByKnowledgePoint(point) {
  if (point.courseId && filter.courseId !== point.courseId) {
    filter.courseId = point.courseId;
    await loadFilterKnowledgeTree();
  }
  filter.knowledgePointId = point.id;
  await loadFirstPage();
}

function handleSizeChange(size) {
  pagination.pageSize = size;
  pagination.page = 1;
  load();
}

function handleCurrentChange(page) {
  pagination.page = page;
  load();
}

function resetOptions() {
  if (form.type === 'material') {
    form.options = [];
    void loadMaterialCandidates();
    if (!form.children.length) addMaterialChild();
    return;
  }
  if (form.type === 'true_false') {
    form.options = [
      { optionKey: 'A', content: '正确', isCorrect: true, sortOrder: 1 },
      { optionKey: 'B', content: '错误', isCorrect: false, sortOrder: 2 },
    ];
    return;
  }

  if (isChoice.value) {
    form.options = baseForm().options.map((option) => ({ ...option }));
    return;
  }

  form.options = [];
}

function addBlankAnswerRow() {
  blankAnswerRows.value = [...blankAnswerRows.value, { answerText: '' }];
}

function removeBlankAnswerRow(index) {
  if (blankAnswerRows.value.length <= 1) return;
  blankAnswerRows.value = blankAnswerRows.value.filter((_, rowIndex) => rowIndex !== index);
}

function insertFormBlankMarker() {
  if (form.type !== 'fill_blank') return;
  if (!blankAnswerRows.value.length) addBlankAnswerRow();
  const marker = '____';
  const current = String(form.content || '');
  const needsSpace = current && !/[\s([{（【]$/.test(current);
  form.content = `${current}${needsSpace ? ' ' : ''}${marker}`;
  if (countBlankMarkers(form.content) > blankAnswerRows.value.length) {
    addBlankAnswerRow();
  }
}

function addOption() {
  const sortOrder = form.options.length + 1;
  form.options.push({
    optionKey: optionKeyForIndex(form.options.length),
    content: '',
    isCorrect: false,
    sortOrder,
  });
}

function removeOption(index) {
  form.options.splice(index, 1);
  renumberOptions();
  if ((form.type === 'single_choice' || form.type === 'true_false') && !form.options.some((option) => option.isCorrect)) {
    form.options[0].isCorrect = true;
  }
}

function renumberOptions() {
  form.options.forEach((option, index) => {
    option.optionKey = optionKeyForIndex(index);
    option.sortOrder = index + 1;
  });
}

function optionKeyForIndex(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `X${index + 1}`;
}

function appendTag(name) {
  if (!form.tagNames.includes(name)) {
    form.tagNames.push(name);
  }
}

function insertCodeBlock(target, field) {
  const block = '\n```python\nprint("hello")\n```\n';
  target[field] = `${target[field] || ''}${block}`;
}

function validateForm() {
  validatePayload({ ...form, courseId: form.courseId }, '当前题目');
}

function validatePayload(payload, label) {
  if (!payload.courseId) throw new Error(`${label}：请选择课程`);
  if (!payload.title?.trim()) throw new Error(`${label}：请填写标题`);
  if (!payload.content?.trim()) throw new Error(`${label}：请填写题干`);
  if (!Number.isFinite(Number(payload.difficulty)) || payload.difficulty < 1 || payload.difficulty > 5) {
    throw new Error(`${label}：难度必须是 1-5`);
  }
  if (!Number.isFinite(Number(payload.defaultScore)) || payload.defaultScore < 0) {
    throw new Error(`${label}：分值不能小于 0`);
  }

  if (isChoiceType(payload.type)) {
    const options = payload.options ?? [];
    const correctCount = options.filter((option) => option.isCorrect).length;
    if (options.length < 2 || options.some((option) => !option.content?.trim())) {
      throw new Error(`${label}：请至少填写两个完整选项`);
    }
    if ((payload.type === 'single_choice' || payload.type === 'true_false') && correctCount !== 1) {
      throw new Error(`${label}：单选/判断题必须有且只有一个正确选项`);
    }
    if (payload.type === 'multiple_choice' && correctCount < 2) {
      throw new Error(`${label}：多选题至少需要两个正确选项`);
    }
  }
  if (payload.type === 'material') {
    if (!payload.children?.length || payload.children.some((child) => !child.questionId || Number(child.score) <= 0)) {
      throw new Error(`${label}：请至少选择一道子题并填写有效分值`);
    }
    if (new Set(payload.children.map((child) => child.questionId)).size !== payload.children.length) {
      throw new Error(`${label}：子题不能重复`);
    }
  }
}

async function buildQuestionPayload(options = {}) {
  const { includeStatus = isEditing.value } = options;
  validateForm();
  const tagIds = await resolveTagIds(form.tagNames);
  const payload = {
    courseId: form.courseId,
    type: form.type,
    title: form.title.trim(),
    content: form.content.trim(),
    difficulty: Number(form.difficulty),
    defaultScore: Number(form.defaultScore),
    analysis: form.analysis?.trim() || '',
    knowledgePointIds: [...form.knowledgePointIds],
    tagIds,
    options: isChoice.value
      ? form.options.map((option, index) => ({
          optionKey: option.optionKey,
          content: option.content.trim(),
          isCorrect: Boolean(option.isCorrect),
          sortOrder: index + 1,
        }))
      : [],
    children: form.type === 'material'
      ? form.children.map((child, index) => ({ questionId: child.questionId, score: Number(child.score), sortOrder: index + 1 }))
      : undefined,
  };

  if (form.type === 'programming') {
    payload.programmingRef = buildProgrammingRefPayload();
  }

  if (includeStatus) {
    payload.status = form.status;
  }

  if (form.type === 'fill_blank') {
    payload.answer = buildFillBlankAnswer(blankAnswerText.value, payload.defaultScore);
  } else if (!isChoice.value && answerReference.value.trim()) {
    payload.answer = { reference: answerReference.value.trim() };
  }

  return payload;
}

async function saveQuestion(shouldPublish) {
  saving.value = true;
  try {
    const payload = await buildQuestionPayload();
    const targetScope = shouldPublish ? 'published' : questionScopeForStatus(payload.status ?? form.status);
    const result = isEditing.value
      ? await updateQuestion(editingId.value, payload)
      : await createQuestion(payload);

    const id = editingId.value || result.id;
    if (shouldPublish) {
      await publishQuestion(id);
    }

    ElMessage.success(shouldPublish ? '已保存并发布' : isEditing.value ? '已保存修改' : '已创建');
    questionScope.value = targetScope;
    editorVisible.value = false;
    resetForm();
    await refreshAll();
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    saving.value = false;
  }
}

function questionScopeForStatus(status) {
  return status === 'published' ? 'published' : 'draft';
}

async function editQuestion(row) {
  let detail;
  try {
    detail = await getQuestion(row.id);
  } catch (error) {
    ElMessage.error(error.message);
    return;
  }
  editMode.value = true;
  editorVisible.value = true;
  editingId.value = detail.id;
  entryMode.value = 'single';
  Object.assign(form, {
    courseId: detail.courseId,
    type: detail.type,
    status: detail.status,
    title: detail.title,
    knowledgePointIds: (detail.knowledgePoints ?? []).map((point) => point.id),
    tagNames: (detail.tags ?? []).map((tag) => tag.name),
    content: detail.content,
    difficulty: detail.difficulty,
    defaultScore: Number(detail.defaultScore),
    analysis: detail.analysis ?? '',
    programmingRef: {
      externalProblemId: detail.programmingRef?.externalProblemId ?? '',
      externalProblemUrl: detail.programmingRef?.externalProblemUrl ?? '',
      platformBaseUrl: detail.programmingRef?.platformBaseUrl ?? detail.programmingRef?.judgeConfig?.platformBaseUrl ?? 'https://oj.example.com',
      domainId: detail.programmingRef?.domainId ?? detail.programmingRef?.judgeConfig?.domainId ?? 'system',
      domainName: detail.programmingRef?.domainName ?? detail.programmingRef?.judgeConfig?.domainName ?? 'system',
      judgeProvider: detail.programmingRef?.judgeProvider ?? detail.programmingRef?.judgeConfig?.platformCode ?? 'hydro',
      accountId: detail.programmingRef?.accountId ?? detail.programmingRef?.judgeConfig?.accountId ?? '',
      accountLabel: detail.programmingRef?.accountLabel ?? detail.programmingRef?.judgeConfig?.accountLabel ?? '',
      languagesText: (detail.programmingRef?.languages ?? []).join(', ') || 'cc.cc17o2, py.py3',
      timeLimit: detail.programmingRef?.timeLimit ?? null,
      memoryLimit: detail.programmingRef?.memoryLimit ?? null,
      judgeConfig: detail.programmingRef?.judgeConfig ?? null,
    },
    options: (detail.options ?? []).map((option, index) => ({
      optionKey: option.optionKey || optionKeyForIndex(index),
      content: option.content,
      isCorrect: option.isCorrect,
      sortOrder: option.sortOrder ?? index + 1,
    })),
    children: (detail.children ?? []).map((child, index) => ({
      questionId: child.questionId,
      score: Number(child.score),
      sortOrder: child.sortOrder ?? index + 1,
    })),
  });
  if (form.type === 'material') await loadMaterialCandidates();
  await loadFormKnowledgeTree();
  if (isChoice.value && !form.options.length) resetOptions();

  const answerJson = detail.answer?.answerJson ?? {};
  blankAnswerText.value = fillBlankAnswerTextFromRules(answerJson.blanks);
  answerReference.value = answerJson.reference ?? '';
}

async function copyQuestion() {
  if (!isEditing.value) {
    ElMessage.warning('请先选择一道题目');
    return;
  }

  saving.value = true;
  try {
    const payload = await buildQuestionPayload({ includeStatus: false });
    payload.title = `${payload.title}（副本）`;
    const created = await createQuestion(payload);
    ElMessage.success('已复制为草稿题目');
    await refreshAll();
    await editQuestion({ id: created.id });
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    saving.value = false;
  }
}

function handleQuestionRowClick(row) {
  if (editMode.value) {
    editQuestion(row);
    return;
  }

  openPracticeQuestion(row);
}

function handleSelectionChange(rows) {
  selectedQuestionRows.value = rows;
}

function openRelatedExams(row) {
  const examId = row.occupationExams?.[0]?.id;
  router.push(examId ? `/exams?focusExamId=${examId}` : '/exams');
}

function onEditModeChange(value) {
  if (!value) {
    closeEditor();
    ElMessage.info('已退出编辑模式，点击题目将进入答题');
    return;
  }

  ElMessage.warning('已进入编辑模式，点击题目将打开编辑/复制窗口');
}

async function bulkDeleteQuestions() {
  if (!selectedQuestionIds.value.length) {
    ElMessage.warning('请选择需要删除的题目');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `风险操作提示：将批量归档 ${selectedQuestionIds.value.length} 道题目，并从引用这些题目的试卷中同步移除题位、重算总分；历史答卷与已生成考试快照仍会保留。`,
      '批量删除题目',
      {
        type: 'warning',
        confirmButtonText: '批量删除',
        cancelButtonText: '取消',
      },
    );
    const result = await bulkDeleteQuestionsRequest({ ids: selectedQuestionIds.value });
    const failedText = result.failed?.length ? `，${result.failed.length} 道失败` : '';
    ElMessage.success(`已删除 ${result.successCount} 道题${failedText}`);
    selectedQuestionRows.value = [];
    await refreshAll();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

async function bulkUpdateQuestionStatus() {
  if (!selectedQuestionIds.value.length || !bulkQuestionStatus.value) {
    ElMessage.warning('请选择题目和目标状态');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `风险操作提示：将批量把 ${selectedQuestionIds.value.length} 道题设置为“${statusLabel(bulkQuestionStatus.value)}”，会影响题库可见性和后续组卷。`,
      '批量设置题目状态',
      {
        type: 'warning',
        confirmButtonText: '批量设置',
        cancelButtonText: '取消',
      },
    );
    const result = await bulkUpdateQuestionStatusRequest({ ids: selectedQuestionIds.value, status: bulkQuestionStatus.value });
    const failedText = result.failed?.length ? `，${result.failed.length} 道失败` : '';
    ElMessage.success(`已设置 ${result.successCount} 道题为${statusLabel(result.status)}${failedText}`);
    selectedQuestionRows.value = [];
    await refreshAll();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

function openQuestionExportDialog(questionIds) {
  const ids = [...questionIds];
  if (!ids.length) {
    ElMessage.warning('请先选择需要导出的题目');
    return;
  }

  pendingExportQuestionIds.value = ids;
  questionExportVisible.value = true;
}

async function exportQuestion(row) {
  openQuestionExportDialog([row.id]);
}

function handleQuestionCommand(row, command) {
  const actions = {
    edit: () => editQuestion(row),
    publish: () => changeStatus(row, 'published'),
    unpublish: () => changeStatus(row, 'draft'),
    hide: () => changeStatus(row, 'disabled'),
    show: () => changeStatus(row, 'draft'),
    download: () => exportQuestion(row),
    delete: () => removeQuestion(row),
  };
  return actions[command]?.();
}

function buildProgrammingRefPayload() {
  normalizeHydroProblemInput(form.programmingRef);
  const externalProblemId = form.programmingRef.externalProblemId.trim();
  if (!externalProblemId) return null;
  const payload = {
    judgeProvider: form.programmingRef.judgeProvider || undefined,
    externalProblemId,
    externalProblemUrl: effectiveHydroProblemUrl(form.programmingRef) || undefined,
    platformBaseUrl: form.programmingRef.platformBaseUrl?.trim() || undefined,
    domainId: form.programmingRef.domainId?.trim() || undefined,
    domainName: form.programmingRef.domainName?.trim() || undefined,
    accountId: form.programmingRef.accountId || undefined,
    accountLabel: form.programmingRef.accountLabel?.trim() || undefined,
    languages: parseHydroLanguages(form.programmingRef.languagesText),
  };
  if (form.programmingRef.timeLimit) payload.timeLimit = Number(form.programmingRef.timeLimit);
  if (form.programmingRef.memoryLimit) payload.memoryLimit = Number(form.programmingRef.memoryLimit);
  if (form.programmingRef.judgeConfig) {
    payload.judgeConfig = {
      ...form.programmingRef.judgeConfig,
      ...(form.programmingRef.judgeProvider ? { platformCode: form.programmingRef.judgeProvider } : {}),
    };
  }
  return payload;
}

async function pullHydroProblem() {
  normalizeHydroProblemInput(form.programmingRef);
  if (!canPullHydroProblem.value) {
    ElMessage.warning('请先填写 Hydro 题号或链接');
    return;
  }

  const problemUrl = effectiveHydroProblemUrl(form.programmingRef);
  hydroPulling.value = true;
  try {
    const pulled = await fetchHydroProblem({
        problemId: form.programmingRef.externalProblemId.trim(),
        problemUrl: problemUrl || undefined,
        platformBaseUrl: form.programmingRef.platformBaseUrl.trim() || undefined,
        domainId: form.programmingRef.domainId.trim() || undefined,
        domainName: form.programmingRef.domainName.trim() || undefined,
        accountId: form.programmingRef.accountId || undefined,
        judgeProvider: form.programmingRef.judgeProvider || undefined,
      });
    applyPulledHydroProblem(form, pulled);
    ElMessage.success('Hydro 题目已拉取');
  } catch (error) {
    ElMessage.error(error.message || 'Hydro 题目拉取失败');
  } finally {
    hydroPulling.value = false;
  }
}

function applyPulledHydroProblem(target, pulled) {
  const ref = pulled.programmingRef ?? pulled;
  target.type = 'programming';
  target.title = pulled.title || target.title;
  target.content = pulled.content || target.content;
  target.programmingRef.externalProblemId = ref.externalProblemId || pulled.externalProblemId || target.programmingRef.externalProblemId;
  target.programmingRef.externalProblemUrl = ref.externalProblemUrl || pulled.externalProblemUrl || target.programmingRef.externalProblemUrl;
  target.programmingRef.platformBaseUrl = ref.platformBaseUrl || ref.judgeConfig?.platformBaseUrl || target.programmingRef.platformBaseUrl;
  target.programmingRef.judgeProvider = ref.judgeProvider || ref.judgeConfig?.platformCode || target.programmingRef.judgeProvider || 'hydro';
  const pulledDomainId = ref.domainId || ref.judgeConfig?.domainId || target.programmingRef.domainId || 'system';
  target.programmingRef.domainId = pulledDomainId;
  target.programmingRef.domainName = ref.domainName || ref.judgeConfig?.domainName || pulledDomainId;
  target.programmingRef.accountId = ref.accountId || ref.judgeConfig?.accountId || target.programmingRef.accountId || '';
  target.programmingRef.accountLabel = ref.accountLabel || ref.judgeConfig?.accountLabel || target.programmingRef.accountLabel || '';
  target.programmingRef.languagesText = (ref.languages || pulled.languages || []).join(', ') || target.programmingRef.languagesText;
  target.programmingRef.timeLimit = ref.timeLimit ?? pulled.timeLimit ?? null;
  target.programmingRef.memoryLimit = ref.memoryLimit ?? pulled.memoryLimit ?? null;
  target.programmingRef.judgeConfig = ref.judgeConfig ?? null;
  resetOptions();
}

function openHydroProblemUrl() {
  if (!hydroProblemUrl.value) return;
  window.open(hydroProblemUrl.value, '_blank', 'noopener,noreferrer');
}

function effectiveHydroProblemUrl(ref) {
  const explicit = String(ref?.externalProblemUrl || '').trim();
  if (!explicit) return '';
  const explicitProblemId = problemIdFromHydroUrl(explicit);
  const currentProblemId = cleanHydroProblemId(ref?.externalProblemId);
  if (explicitProblemId && currentProblemId && explicitProblemId !== currentProblemId) return '';
  return explicit;
}

function cleanHydroProblemId(value) {
  return String(value || '').trim().replace(/^#/, '');
}

function parseHydroProblemUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    const problemId = problemIdFromHydroUrl(raw);
    if (!problemId) return null;
    return {
      url: raw,
      problemId,
      baseUrl: `${parsed.protocol}//${parsed.host}`,
      domainId: domainIdFromHydroUrl(raw) || 'system',
    };
  } catch {
    return null;
  }
}

function problemIdFromHydroUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/p\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]).trim() : '';
}

function domainIdFromHydroUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/\/d\/([^/]+)\/p\//);
  return match?.[1] ? decodeURIComponent(match[1]).trim() : 'system';
}

function normalizeBaseUrl(value) {
  const raw = String(value || 'https://oj.example.com').trim() || 'https://oj.example.com';
  return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
}

function shortHost(value) {
  try {
    return new URL(normalizeBaseUrl(value)).host;
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

function baseUrlFromProblemUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function programmingRefBaseUrl(ref) {
  const raw = ref?.platformBaseUrl || baseUrlFromProblemUrl(ref?.externalProblemUrl);
  return raw ? normalizeBaseUrl(raw) : '';
}

function matchingHydroAccountsForRef(ref) {
  const targetBaseUrl = programmingRefBaseUrl(ref);
  if (!targetBaseUrl) return hydroAccounts.value;
  return hydroAccounts.value.filter((account) => sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl));
}

function matchedHydroAccountsFor(question) {
  const targetBaseUrl = programmingRefBaseUrl(question?.programmingRef);
  if (!targetBaseUrl) return [];
  return hydroAccounts.value.filter(
    (account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl),
  );
}

function defaultHydroAccountId(question) {
  const matched = matchedHydroAccountsFor(question);
  const boundAccountId = question?.programmingRef?.accountId;
  return matched.find((account) => account.id === boundAccountId)?.id || matched[0]?.id || '';
}

function hydroPracticeAccountLabel(account) {
  return `${account.loginUsername || account.hydroUsername || 'Hydro账号'} · ${shortHost(account.platformBaseUrl)}`;
}

function sameHydroBaseUrl(left, right) {
  const leftHost = canonicalHost(left);
  const rightHost = canonicalHost(right);
  return Boolean(leftHost && rightHost && leftHost === rightHost);
}

function canonicalHost(value) {
  return shortHost(value).toLowerCase().replace(/^www\./, '');
}

function hydroSourceLabel(ref) {
  const host = shortHost(programmingRefBaseUrl(ref));
  const domain = ref?.domainName || ref?.domainId || 'system';
  return [host, domain && domain !== 'system' ? domain : 'system'].filter(Boolean).join(' / ');
}

function parseHydroLanguages(value) {
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function exportQuestions(questionIds) {
  try {
    await createExportTask({
        type: 'question_bank',
        format: questionExportOptions.format,
        questionIds,
        includeAnswers: questionExportOptions.includeAnswers,
        includeAnalysis: questionExportOptions.includeAnalysis,
    });
    ElMessage.success('题目导出任务已加入队列，可到导出中心下载');
  } catch (error) {
    ElMessage.error(error.message || '题目导出失败');
  }
}

async function confirmQuestionExport() {
  await exportQuestions(pendingExportQuestionIds.value);
  questionExportVisible.value = false;
}

function closeEditor() {
  editorVisible.value = false;
  resetForm();
}

async function openPracticeQuestion(row) {
  try {
    practiceDetail.value = await getQuestion(row.id);
    clearPracticeAnswer();
    practiceHydroAccountId.value =
      practiceDetail.value?.type === 'programming' ? defaultHydroAccountId(practiceDetail.value) : '';
    practiceVisible.value = true;
  } catch (error) {
    ElMessage.error(error.message);
  }
}

function editQuestionFromPractice() {
  const detail = practiceDetail.value;
  practiceVisible.value = false;
  if (detail) {
    editMode.value = true;
    editQuestion(detail);
  }
}

async function checkPracticeAnswer() {
  if (!practiceDetail.value) return;
  if (practiceDetail.value.type === 'programming') {
    await submitPracticeProgrammingAnswer();
    return;
  }
  if (practiceDetail.value.type === 'material') {
    await checkMaterialPracticeAnswer();
    return;
  }
  try {
    practiceResult.value = await checkQuestionAnswer(practiceDetail.value.id, payloadForPracticeAnswer());
  } catch (error) {
    ElMessage.error(error.message);
  }
}

async function submitPracticeProgrammingAnswer() {
  if (!practiceDetail.value) return;
  if (!String(practiceAnswer.code ?? '').trim()) {
    ElMessage.warning('请先填写代码');
    return;
  }
  if (!practiceHydroAccountId.value) {
    ElMessage.warning('请选择当前题目来源站点下的提交账号');
    return;
  }
  practiceProgrammingSubmitLoading.value = true;
  try {
    const response = await submitHydroPracticeCode(practiceDetail.value.id, {
        language: practiceAnswer.language || languageOptionsFor(practiceDetail.value)[0],
        code: practiceAnswer.code,
        accountId: practiceHydroAccountId.value,
    });
    practiceProgrammingResult.value = response;
    ElMessage.success(response.message || '代码已提交到 Hydro');
  } catch (error) {
    ElMessage.error(error.message || 'Hydro 提交失败');
  } finally {
    practiceProgrammingSubmitLoading.value = false;
  }
}

function openHydroProblem(question) {
  const url = question?.programmingRef?.externalProblemUrl;
  if (!url) {
    ElMessage.warning('该题尚未配置 Hydro 链接');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function emptyPracticeAnswer(question = null) {
  return {
    selectedOptionIds: [],
    blanks: blankAnswerList(question),
    text: '',
    code: '',
    language: languageOptionsFor(question)[0] || 'cc.cc17o2',
  };
}

function clearPracticeAnswer() {
  Object.assign(practiceAnswer, emptyPracticeAnswer(practiceDetail.value));
  resetPracticeChildState();
  if (practiceDetail.value?.type === 'material') {
    for (const child of materialChildren(practiceDetail.value)) {
      practiceChildAnswers[materialChildId(child)] = emptyPracticeAnswer(materialChildQuestion(child));
    }
  }
  practiceResult.value = null;
  practiceProgrammingResult.value = null;
}

function updatePracticeAnswer(value) {
  Object.assign(practiceAnswer, {
    selectedOptionIds: Array.isArray(value?.selectedOptionIds) ? value.selectedOptionIds : [],
    blanks: Array.isArray(value?.blanks) ? value.blanks : blankAnswerList(practiceDetail.value),
    text: value?.text ?? '',
    code: value?.code ?? practiceAnswer.code ?? '',
    language: value?.language ?? practiceAnswer.language ?? languageOptionsFor(practiceDetail.value)[0] ?? 'cc.cc17o2',
  });
}

function payloadForPracticeAnswer() {
  return payloadForAnswer(practiceAnswer);
}

function payloadForAnswer(answerValue) {
  if (answerValue?.selectedOptionIds?.filter(Boolean).length) {
    return { selectedOptionIds: answerValue.selectedOptionIds.filter(Boolean) };
  }
  if (answerValue?.blanks?.some((blank) => String(blank.value ?? '').trim())) {
    return { blanks: answerValue.blanks };
  }
  if (String(answerValue?.text ?? '').trim()) {
    return { text: answerValue.text };
  }
  if (String(answerValue?.code ?? '').trim()) {
    return {
      text: answerValue.code,
      code: answerValue.code,
      language: answerValue.language || 'cc.cc17o2',
    };
  }
  return {};
}

function resetPracticeChildState() {
  Object.keys(practiceChildAnswers).forEach((key) => delete practiceChildAnswers[key]);
  Object.keys(practiceChildResults).forEach((key) => delete practiceChildResults[key]);
}

function updatePracticeChildAnswers(value) {
  Object.keys(practiceChildAnswers).forEach((key) => delete practiceChildAnswers[key]);
  Object.entries(value || {}).forEach(([key, childAnswer]) => {
    practiceChildAnswers[key] = childAnswer || {};
  });
}

function materialChildren(question) {
  return Array.isArray(question?.children) ? question.children : [];
}

function materialChildQuestion(child) {
  const question = child?.question || child?.snapshot || child || {};
  return {
    ...question,
    id: question.id || question.questionId || child?.questionId,
    questionId: question.questionId || question.id || child?.questionId,
    defaultScore: materialChildScore(child),
  };
}

function materialChildId(child) {
  const question = materialChildQuestion(child);
  return question.questionId || question.id || child?.questionId;
}

function materialChildScore(child) {
  const explicit = Number(child?.score);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const fallback = Number((child?.question || child?.snapshot || child || {}).defaultScore);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function hasPracticeAnswer(answerValue) {
  return Boolean(
    answerValue?.selectedOptionIds?.filter(Boolean).length
    || answerValue?.blanks?.some((blank) => String(blank.value ?? '').trim())
    || String(answerValue?.text ?? '').trim()
    || String(answerValue?.code ?? '').trim(),
  );
}

async function checkMaterialPracticeAnswer() {
  const children = materialChildren(practiceDetail.value);
  if (!children.length) {
    ElMessage.warning('该材料/组合题尚未配置子题');
    return;
  }

  const missingIndex = children.findIndex((child) => !hasPracticeAnswer(practiceChildAnswers[materialChildId(child)]));
  if (missingIndex >= 0) {
    ElMessage.warning(`请先完成第 ${missingIndex + 1} 道子题`);
    return;
  }

  try {
    const results = [];
    Object.keys(practiceChildResults).forEach((key) => delete practiceChildResults[key]);
    for (const child of children) {
      const childId = materialChildId(child);
      const response = await checkQuestionAnswer(childId, payloadForAnswer(practiceChildAnswers[childId] || {}));
      const scaled = scaleMaterialChildResult(response, materialChildScore(child));
      practiceChildResults[childId] = scaled;
      results.push(scaled);
    }

    const score = roundScore(results.reduce((sum, item) => sum + Number(item.score || 0), 0));
    const totalScore = roundScore(children.reduce((sum, child) => sum + materialChildScore(child), 0));
    const hasWrong = results.some((item) => item.isCorrect === false);
    const hasPending = results.some((item) => item.isCorrect === null || item.status === 'manual_needed');
    practiceResult.value = {
      isCorrect: hasPending ? null : !hasWrong,
      score,
      totalScore,
      status: hasPending ? 'manual_needed' : 'auto_graded',
      message: hasPending ? '材料/组合题已提交，部分子题待批改' : hasWrong ? '材料/组合题存在错误' : '材料/组合题回答正确',
      details: results.map((item, index) => ({
        childIndex: index + 1,
        questionId: materialChildId(children[index]),
        score: item.score,
        totalScore: item.totalScore,
        isCorrect: item.isCorrect,
        status: item.status,
      })),
    };
  } catch (error) {
    ElMessage.error(error.message);
  }
}

function scaleMaterialChildResult(result, targetScore) {
  const sourceTotal = Number(result?.totalScore);
  const score = Number(result?.score);
  if (!Number.isFinite(sourceTotal) || sourceTotal <= 0 || !Number.isFinite(score)) {
    return { ...result, score: 0, totalScore: targetScore };
  }
  if (Math.abs(sourceTotal - targetScore) < 0.0001) return result;
  return {
    ...result,
    score: roundScore((score / sourceTotal) * targetScore),
    totalScore: targetScore,
  };
}

function roundScore(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(2)) : 0;
}

function blankCountFor(question) {
  const explicit = Number(question?.blankCount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const answerBlanks = question?.answer?.blanks;
  if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
  return Math.max(1, countBlankMarkers(question?.content));
}

function blankAnswerList(question, existing = []) {
  const source = Array.isArray(existing) ? existing : [];
  const count = Math.max(blankCountFor(question), ...source.map((blank) => Number(blank?.index) || 0), 1);
  return Array.from({ length: count }, (_, index) => {
    const blankIndex = index + 1;
    const current = source.find((blank) => Number(blank?.index) === blankIndex);
    return { index: blankIndex, value: current?.value ?? '' };
  });
}

function countBlankMarkers(content) {
  const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
  return matches?.length || 1;
}

function resetForm() {
  editingId.value = '';
  Object.assign(form, baseForm(), { courseId: courses.value[0]?.id ?? '' });
  blankAnswerRows.value = emptyFillBlankRows();
  answerReference.value = '';
  loadFormKnowledgeTree();
}

async function changeStatus(row, status) {
  try {
    if (editMode.value) {
      await ElMessageBox.confirm(
        `风险操作提示：将“${row.title}”设置为${statusLabel(status)}会影响题库可见性和后续组卷，已生成试卷快照不会自动同步。`,
        '确认状态变更',
        {
          type: 'warning',
          confirmButtonText: `设置为${statusLabel(status)}`,
          cancelButtonText: '取消',
        },
      );
    }
    if (status === 'published') {
      await publishQuestion(row.id);
    } else {
      await updateQuestion(row.id, { status });
    }
    ElMessage.success(`已设置为${statusLabel(status)}`);
    await load();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

async function removeQuestion(row) {
  try {
    const impact = await getQuestionDeleteImpact(row.id);
    const references = impact.references || {};
    const resources = impact.resources || [];
    const risks = impact.risks || [];
    const relatedPaperNames = (impact.relatedPapers || []).slice(0, 5).map((paper) => paper.name).join('、');
    const resourceReferenceCount = resources.reduce((sum, item) => sum + Number(item.referenceCount || 0), 0);
    const resourceLocations = resources
      .flatMap((item) => item.locations || [])
      .slice(0, 3)
      .join('；');
    const lines = [
      `试卷引用：${references.paperCount || 0} 份 / ${references.paperQuestionCount || 0} 个位置`,
      ...(relatedPaperNames ? [`关联试卷：${relatedPaperNames}${impact.relatedPapers.length > 5 ? ' 等' : ''}`] : []),
      `关联考试：${references.examCount || 0} 场，其中进行中或已安排 ${references.activeExamCount || 0} 场`,
      `试卷快照：${references.paperInstanceCount || 0} 份`,
      `答题记录：${references.answerRecordCount || 0} 条，错题记录：${references.wrongQuestionCount || 0} 条`,
      `资源引用：${resources.length} 个资源 / ${resourceReferenceCount} 处引用${resources.some((item) => !item.managed) ? '（含未纳管资源）' : ''}`,
      ...(resourceLocations ? [`资源位置：${resourceLocations}`] : []),
      ...risks,
    ];
    await ElMessageBox.confirm(
      `确认删除题目“${row.title}”？\n\n${lines.join('\n')}\n\n删除后题目会归档，并从上述试卷中同步移除；历史答卷和已生成的考试快照仍会保留。`,
      '删除题目风险确认',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      },
    );
    const result = await removeQuestionRequest(row.id);
    ElMessage.success(result.message || '已删除');
    if (editingId.value === row.id) resetForm();
    await load();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message ?? '已取消');
    }
  }
}

async function resolveTagIds(tagNames = []) {
  const names = [...new Set(tagNames.map((name) => String(name).trim()).filter(Boolean))];
  const ids = [];

  for (const [index, name] of names.entries()) {
    const existing = tags.value.find((tag) => tag.name === name);
    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const created = await createQuestionTag({
        name,
        code: makeTagCode(name, index),
        type: 'QUESTION',
    });
    ids.push(created.id);
    tags.value.unshift(created);
  }

  return ids;
}

function makeTagCode(name, index) {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  return `q_${ascii || 'tag'}_${Date.now()}_${index}`;
}

function isChoiceType(type) {
  return ['single_choice', 'multiple_choice', 'true_false'].includes(type);
}

function typeLabel(value) {
  return typeOptions.find((item) => item.value === value)?.label ?? value ?? '';
}

function statusLabel(value) {
  return statusOptions.find((item) => item.value === value)?.label ?? value ?? '';
}

function statusTagType(value) {
  const map = {
    draft: 'info',
    pending_review: 'warning',
    published: 'success',
    disabled: 'danger',
  };
  return map[value] ?? 'info';
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function convertKnowledgeTree(items) {
  return items.map((item) => ({
    label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
    value: item.id,
    children: convertKnowledgeTree(item.children ?? []),
  }));
}

onMounted(async () => {
  await Promise.all([loadCourses(), loadTags(), loadHydroPlatforms(), loadHydroAccounts()]);
  await load();
});

return {
  Check,
  Close,
  Delete,
  DocumentAdd,
  DocumentCopy,
  Download,
  Edit,
  ElMessage,
  ElMessageBox,
  Hide,
  Link,
  MoreFilled,
  Plus,
  Refresh,
  Search,
  Upload,
  View,
  addBlankAnswerRow,
  addMaterialChild,
  addOption,
  answerLayout,
  answerReference,
  appendTag,
  applyHydroSiteToRef,
  applyPulledHydroProblem,
  baseForm,
  baseUrlFromProblemUrl,
  blankAnswerList,
  blankAnswerRows,
  blankAnswerText,
  blankCountFor,
  buildFillBlankAnswer,
  buildProgrammingRefPayload,
  buildQuestionPayload,
  bulkDeleteQuestions,
  bulkDeleteQuestionsRequest,
  bulkQuestionStatus,
  bulkUpdateQuestionStatus,
  bulkUpdateQuestionStatusRequest,
  canPullHydroProblem,
  canonicalHost,
  changeStatus,
  checkMaterialPracticeAnswer,
  checkPracticeAnswer,
  checkQuestionAnswer,
  cleanHydroProblemId,
  clearPracticeAnswer,
  closeEditor,
  computed,
  confirmQuestionExport,
  convertKnowledgeTree,
  copyQuestion,
  correctChoiceKey,
  countBlankMarkers,
  courses,
  createExportTask,
  createQuestion,
  createQuestionTag,
  defaultHydroAccountId,
  domainIdFromHydroUrl,
  editMode,
  editQuestion,
  editQuestionFromPractice,
  editingId,
  editorTitle,
  editorVisible,
  effectiveHydroProblemUrl,
  emptyFillBlankRows,
  emptyPracticeAnswer,
  emptyProgrammingRef,
  entryMode,
  exportQuestion,
  exportQuestions,
  fetchHydroProblem,
  fillBlankAnswerTextFromRows,
  fillBlankAnswerTextFromRules,
  fillBlankRowsFromText,
  filter,
  filterByKnowledgePoint,
  filterByTag,
  filterKnowledgeTree,
  filterKnowledgeTreeOptions,
  form,
  formKnowledgeTree,
  formKnowledgeTreeOptions,
  formatDateTime,
  formatHydroDomainLabel,
  getKnowledgePointTree,
  getQuestion,
  getQuestionDeleteImpact,
  handleCurrentChange,
  handleFilterCourseChange,
  handleFormCourseChange,
  handleHydroAccountChange,
  handleHydroProblemInputChange,
  handleHydroSiteChange,
  handleQuestionCommand,
  handleQuestionRowClick,
  handleQuestionSortChange,
  handleSelectionChange,
  handleSizeChange,
  hasPracticeAnswer,
  hydroAccountOptions,
  hydroAccounts,
  hydroBindingLabel,
  hydroPlatforms,
  hydroPracticeAccountLabel,
  hydroProblemUrl,
  hydroPulling,
  hydroSiteOptions,
  hydroSourceLabel,
  insertCodeBlock,
  insertFormBlankMarker,
  isChoice,
  isChoiceType,
  isEditing,
  isFullProgrammingScore,
  isMaterialCandidateDisabled,
  isProgrammingFinal,
  items,
  languageLabel,
  languageOptionsFor,
  listHydroPlatforms,
  listMyHydroAccounts,
  listQuestionCourses,
  listQuestionTags,
  listQuestions,
  load,
  loadCourses,
  loadFilterKnowledgeTree,
  loadFirstPage,
  loadFormKnowledgeTree,
  loadHydroAccounts,
  loadHydroPlatforms,
  loadMaterialCandidates,
  loadTags,
  makeTagCode,
  matchedHydroAccountsFor,
  matchingHydroAccountForSite,
  matchingHydroAccountsForRef,
  materialCandidates,
  materialChildId,
  materialChildQuestion,
  materialChildScore,
  materialChildren,
  normalizeBaseUrl,
  normalizeHydroProblemInput,
  onEditModeChange,
  onMounted,
  openHydroProblem,
  openHydroProblemUrl,
  openPracticeQuestion,
  openQuestionExportDialog,
  openRelatedExams,
  optionKeyForIndex,
  pageSizes,
  pagination,
  parseHydroLanguages,
  parseHydroProblemUrl,
  payloadForAnswer,
  payloadForPracticeAnswer,
  pendingExportQuestionIds,
  practiceAnswer,
  practiceChildAnswers,
  practiceChildResults,
  practiceDetail,
  practiceDialogWidth,
  practiceHydroAccountId,
  practiceMatchedHydroAccounts,
  practiceProgrammingResult,
  practiceProgrammingSubmitLoading,
  practiceResult,
  practiceVisible,
  previewVisible,
  problemIdFromHydroUrl,
  programmingFeedbackTitle,
  programmingFeedbackType,
  programmingRefBaseUrl,
  publishQuestion,
  pullHydroProblem,
  questionExportOptions,
  questionExportVisible,
  questionScope,
  questionScopeForStatus,
  quickTags,
  reactive,
  ref,
  refreshAll,
  removeBlankAnswerRow,
  removeMaterialChild,
  removeOption,
  removeQuestion,
  removeQuestionRequest,
  renumberOptions,
  resetForm,
  resetOptions,
  resetPracticeChildState,
  resolveTagIds,
  roundScore,
  router,
  sameHydroBaseUrl,
  saveQuestion,
  saving,
  scaleMaterialChildResult,
  selectedHydroAccount,
  selectedQuestionIds,
  selectedQuestionRows,
  shortHost,
  showLowColumns,
  showMediumColumns,
  statusLabel,
  statusOptions,
  statusSegmentOptions,
  statusTagType,
  submitHydroPracticeCode,
  submitPracticeProgrammingAnswer,
  syncHydroAccountForSite,
  tags,
  typeLabel,
  typeOptions,
  updatePracticeAnswer,
  updatePracticeChildAnswers,
  updateQuestion,
  useQuestionTypeOptions,
  useResponsiveColumns,
  useRouter,
  validateForm,
  validatePayload,
  watch,
};
}
