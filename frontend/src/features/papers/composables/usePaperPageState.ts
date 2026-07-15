import { reactive, ref } from 'vue';
import type {
  EditablePaperDetail,
  KnowledgeTreeNode,
  NamedOption,
  PaperListItem,
  PaperSnapshotOption,
  QuestionListItem,
} from '../models';

export function usePaperPageState() {
  const courses = ref<NamedOption[]>([]);
  const papers = ref<PaperListItem[]>([]);
  const questions = ref<QuestionListItem[]>([]);
  const tags = ref<NamedOption[]>([]);
  const bulkKnowledgeTree = ref<KnowledgeTreeNode[]>([]);
  const detail = ref<EditablePaperDetail | null>(null);
  const selectedPaperId = ref('');
  const createPaperVisible = ref(false);
  const wrongFrequencyVisible = ref(false);
  const paperEditorVisible = ref(false);
  const paperPreviewVisible = ref(false);
  const paperEditorTab = ref('info');
  const snapshotEditorVisible = ref(false);
  const snapshotSaving = ref(false);
  const paperImporting = ref(false);
  const paperImportUploadKey = ref(0);
  const paperScope = ref('published');
  const paperFilter = reactive<{
    keyword: string;
    courseId: string;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  }>({ keyword: '', courseId: '', sortBy: 'createdAt', sortOrder: 'desc' });
  const paperPagination = reactive({ page: 1, pageSize: 20, total: 0 });
  const form = reactive({ name: '', courseId: '', durationMinutes: 60, type: 'fixed' });
  const editPaperForm = reactive({
    name: '', courseId: '', durationMinutes: 60, type: 'fixed',
    shuffleQuestions: false, shuffleOptions: false,
  });
  const addForm = reactive({ questionId: '', sectionTitle: '客观题', score: 2 });
  const bulkForm = reactive({
    courseId: '', knowledgePointIds: [] as string[], tagIds: [] as string[],
    questionType: '', sectionTitle: '按标签导入', scoreEach: 2, random: false, count: 5,
  });
  const wrongFrequencyForm = reactive({
    name: '', courseId: '', questionType: '', sectionTitle: '高频错题',
    count: 10, minWrongCount: 1, scoreEach: 2,
  });
  const snapshotForm = reactive({
    paperQuestionId: '', title: '', content: '', analysis: '',
    options: [] as PaperSnapshotOption[],
  });
  const pageSizes = [20, 50, 100];

  return {
    courses, papers, questions, tags, bulkKnowledgeTree, detail, selectedPaperId,
    createPaperVisible, wrongFrequencyVisible, paperEditorVisible, paperPreviewVisible,
    paperEditorTab, snapshotEditorVisible, snapshotSaving, paperImporting,
    paperImportUploadKey, paperScope, paperFilter, paperPagination, form,
    editPaperForm, addForm, bulkForm, wrongFrequencyForm, snapshotForm, pageSizes,
  };
}
