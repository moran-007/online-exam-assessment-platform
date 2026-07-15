import { ElMessage, ElMessageBox, type UploadFile } from 'element-plus';
import { getKnowledgeTree, listCourses, listTags } from '../../platform/api';
import { listQuestions } from '../../questions/api';
import {
  copyPaper,
  createPaper as createPaperRequest,
  generatePaperFromWrongFrequency,
  getPaper,
  importPaper,
  listPapers,
} from '../api';
import type {
  KnowledgeTreeNode,
  NamedOption,
  PaperDetail,
  PaperListItem,
  QuestionListItem,
} from '../models';
import { readPaperImportJson, readPaperImportZip } from './paperImportCodec';
import type { usePaperPageState } from './usePaperPageState';

type State = ReturnType<typeof usePaperPageState>;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function usePaperCatalog(options: {
  state: State;
  decoratePaperDetail: (paper: PaperDetail) => NonNullable<State['detail']['value']>;
  syncSelectedQuestionScore: () => void;
  loadBulkKnowledgeTree: () => Promise<void>;
  changePaperStatus: (row: unknown, status: string) => Promise<void>;
  answerPaper: (row?: unknown) => void;
}) {
  const {
    state, decoratePaperDetail, syncSelectedQuestionScore, loadBulkKnowledgeTree,
    changePaperStatus, answerPaper,
  } = options;

  async function loadAll() {
    const [coursePage, paperPage, questionPage, tagPage] = await Promise.all([
      listCourses({ pageSize: 100 }),
      listPapers({
        page: state.paperPagination.page,
        pageSize: state.paperPagination.pageSize,
        keyword: state.paperFilter.keyword || undefined,
        courseId: state.paperFilter.courseId || undefined,
        scope: state.paperScope.value,
        sortBy: state.paperFilter.sortBy,
        sortOrder: state.paperFilter.sortOrder,
      }),
      listQuestions({ pageSize: 100, status: 'published' }),
      listTags({ pageSize: 100, type: 'QUESTION' }),
    ]);
    state.courses.value = coursePage.items as NamedOption[];
    state.papers.value = paperPage.items;
    Object.assign(state.paperPagination, {
      page: paperPage.page,
      pageSize: paperPage.pageSize,
      total: paperPage.total,
    });
    state.questions.value = questionPage.items as QuestionListItem[];
    state.tags.value = tagPage.items as NamedOption[];
    state.form.courseId ||= state.courses.value[0]?.id || '';
    state.wrongFrequencyForm.courseId ||= state.form.courseId;
    state.bulkForm.courseId ||= state.form.courseId;
    state.addForm.questionId ||= state.questions.value[0]?.id || '';
    syncSelectedQuestionScore();
    if (!state.papers.value.some((paper) => paper.id === state.selectedPaperId.value)) {
      state.selectedPaperId.value = state.papers.value[0]?.id || '';
      state.detail.value = null;
    }
    if (state.selectedPaperId.value) await loadDetail();
    await loadBulkKnowledgeTree();
  }

  function loadFirstPaperPage() {
    state.paperPagination.page = 1;
    return loadAll();
  }

  function handlePaperSortChange({ prop, order }: { prop?: string | null; order?: string | null }) {
    state.paperFilter.sortBy = prop || 'createdAt';
    state.paperFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
    return loadFirstPaperPage();
  }

  function handlePaperSizeChange(size: number) {
    state.paperPagination.pageSize = size;
    state.paperPagination.page = 1;
    void loadAll();
  }

  function handlePaperCurrentChange(page: number) {
    state.paperPagination.page = page;
    void loadAll();
  }

  async function createPaper() {
    if (!state.form.name.trim()) {
      ElMessage.error('请填写试卷名称');
      return;
    }
    const created = await createPaperRequest(state.form);
    ElMessage.success('已创建');
    state.form.name = '';
    state.createPaperVisible.value = false;
    selectDraftAndNewest(created.id);
    await loadAll();
    state.paperPreviewVisible.value = true;
  }

  async function handlePaperImportChange(uploadFile: UploadFile) {
    const file = uploadFile.raw;
    if (!file) return;
    state.paperImporting.value = true;
    try {
      const packageData = file.name.toLowerCase().endsWith('.zip')
        ? await readPaperImportZip(file)
        : readPaperImportJson(JSON.parse(await file.text()) as unknown);
      const courseId = state.paperFilter.courseId || state.form.courseId || packageData.questions[0]?.courseId;
      if (!courseId) {
        ElMessage.error('请先选择导入试卷所属课程');
        return;
      }
      const result = await importPaper({
        name: packageData.paperName,
        courseId,
        durationMinutes: packageData.durationMinutes,
        shuffleQuestions: packageData.shuffleQuestions,
        shuffleOptions: packageData.shuffleOptions,
        reuseExisting: true,
        questions: packageData.questions,
      });
      ElMessage.success(`已导入试卷：${result.questionCount} 题，复用 ${result.reusedCount} 题`);
      state.paperFilter.courseId = courseId;
      selectDraftAndNewest(result.paperId);
      await loadAll();
      state.paperPreviewVisible.value = true;
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '试卷导入失败'));
    } finally {
      state.paperImporting.value = false;
      state.paperImportUploadKey.value += 1;
    }
  }

  function openWrongFrequencyDialog() {
    state.wrongFrequencyForm.courseId = state.paperFilter.courseId
      || state.detail.value?.courseId || state.wrongFrequencyForm.courseId || state.form.courseId;
    state.wrongFrequencyVisible.value = true;
  }

  async function generateWrongFrequencyPaper() {
    if (!state.wrongFrequencyForm.courseId) {
      ElMessage.error('请选择课程');
      return;
    }
    const result = await generatePaperFromWrongFrequency({
      ...state.wrongFrequencyForm,
      name: state.wrongFrequencyForm.name.trim() || undefined,
      questionType: state.wrongFrequencyForm.questionType || undefined,
      sectionTitle: state.wrongFrequencyForm.sectionTitle.trim() || undefined,
    });
    ElMessage.success(`已按错题频次生成 ${result.questionCount} 道题`);
    state.wrongFrequencyVisible.value = false;
    selectDraftAndNewest(result.paperId);
    await loadAll();
    state.paperPreviewVisible.value = true;
  }

  async function selectPaper(value?: unknown) {
    const row = paperRow(value);
    if (!row?.id) return;
    state.selectedPaperId.value = row.id;
    await loadDetail();
  }

  async function previewPaper(value: unknown) {
    await selectPaper(value);
    if (state.detail.value) state.paperPreviewVisible.value = true;
  }

  async function openPaperEditor(value?: unknown) {
    const row = paperRow(value);
    if (row?.id) await selectPaper(row);
    if (!state.detail.value) {
      ElMessage.warning('请先选择试卷');
      return;
    }
    state.paperEditorVisible.value = true;
  }

  function handlePaperCommand(row: unknown, value: unknown) {
    const command = String(value || '');
    if (command === 'preview') return previewPaper(row);
    if (command === 'edit') return openPaperEditor(row);
    if (command === 'answer') return answerPaper(row);
    if (command === 'copy') return copyPaperAsDraft(row);
    if (command.startsWith('status:')) return changePaperStatus(row, command.slice('status:'.length));
  }

  async function copyPaperAsDraft(value?: unknown) {
    const row = paperRow(value);
    const sourceId = row?.id || state.selectedPaperId.value;
    if (!sourceId) {
      ElMessage.warning('请先选择试卷');
      return;
    }
    try {
      await ElMessageBox.confirm(
        '将复制为新的草稿试卷，可继续修改题目、分值和排序，不会影响原试卷。',
        '复制为草稿',
        { type: 'warning', confirmButtonText: '复制草稿', cancelButtonText: '取消' },
      );
      const created = await copyPaper(sourceId);
      ElMessage.success('已复制为草稿试卷');
      selectDraftAndNewest(created.id);
      await loadAll();
      state.paperPreviewVisible.value = true;
    } catch (error: unknown) {
      if (error !== 'cancel') ElMessage.error(errorMessage(error, '复制失败'));
    }
  }

  async function loadDetail() {
    state.detail.value = state.selectedPaperId.value
      ? decoratePaperDetail(await getPaper(state.selectedPaperId.value))
      : null;
    if (!state.detail.value) return;
    Object.assign(state.editPaperForm, {
      name: state.detail.value.name,
      courseId: state.detail.value.courseId,
      durationMinutes: state.detail.value.durationMinutes,
      type: state.detail.value.type || 'fixed',
      shuffleQuestions: Boolean(state.detail.value.shuffleQuestions),
      shuffleOptions: Boolean(state.detail.value.shuffleOptions),
    });
    state.bulkForm.courseId = state.detail.value.courseId || state.bulkForm.courseId || '';
    await loadBulkKnowledgeTree();
  }

  async function refreshSelectedPaper() {
    const currentId = state.selectedPaperId.value;
    await loadAll();
    state.selectedPaperId.value = currentId;
    await loadDetail();
  }

  function selectDraftAndNewest(id: string) {
    state.paperScope.value = 'draft';
    state.paperFilter.sortBy = 'createdAt';
    state.paperFilter.sortOrder = 'desc';
    state.paperPagination.page = 1;
    state.selectedPaperId.value = id;
  }

  async function loadBulkKnowledgeTreeDirect() {
    state.bulkKnowledgeTree.value = state.bulkForm.courseId
      ? await getKnowledgeTree(state.bulkForm.courseId) as KnowledgeTreeNode[]
      : [];
  }

  return {
    loadAll, loadFirstPaperPage, handlePaperSortChange, handlePaperSizeChange,
    handlePaperCurrentChange, createPaper, handlePaperImportChange,
    openWrongFrequencyDialog, generateWrongFrequencyPaper, selectPaper, previewPaper,
    openPaperEditor, handlePaperCommand, copyPaperAsDraft, loadDetail,
    refreshSelectedPaper, loadBulkKnowledgeTreeDirect,
  };
}

function paperRow(value: unknown): Partial<PaperListItem> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<PaperListItem>
    : {};
}
