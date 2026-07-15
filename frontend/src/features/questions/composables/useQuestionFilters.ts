import type { Ref } from 'vue';
import {
  getKnowledgePointTree,
  listQuestionCourses,
  listQuestions,
  listQuestionTags,
} from '../api';
import type {
  KnowledgePointTreeNode,
  NamedOption,
  QuestionForm,
  QuestionRecord,
} from '../models';

type FilterState = {
  courses: Ref<NamedOption[]>;
  tags: Ref<NamedOption[]>;
  formKnowledgeTree: Ref<KnowledgePointTreeNode[]>;
  filterKnowledgeTree: Ref<KnowledgePointTreeNode[]>;
  items: Ref<QuestionRecord[]>;
  materialCandidates: Ref<QuestionRecord[]>;
  editingId: Ref<string>;
  questionScope: Ref<string>;
  form: QuestionForm;
  filter: {
    courseId: string;
    knowledgePointId: string;
    tagId: string;
    type: string;
    keyword: string;
    sortBy: string;
    sortOrder: string;
  };
  pagination: { page: number; pageSize: number; total: number };
};

export function useQuestionFilters(state: FilterState) {
  const {
    courses,
    editingId,
    filter,
    filterKnowledgeTree,
    form,
    formKnowledgeTree,
    items,
    materialCandidates,
    pagination,
    questionScope,
    tags,
  } = state;

  async function loadCourses() {
    const data = await listQuestionCourses();
    courses.value = data.items;
    if (!form.courseId) form.courseId = courses.value[0]?.id ?? '';
    await loadFormKnowledgeTree();
    await loadFilterKnowledgeTree();
  }

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

  function removeMaterialChild(index: number) {
    form.children.splice(index, 1);
  }

  function isMaterialCandidateDisabled(candidateId: string, currentIndex: number) {
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
        sortOrder: filter.sortOrder as 'asc' | 'desc',
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

  function handleQuestionSortChange({ prop, order }: { prop: string | null; order: 'ascending' | 'descending' | null }) {
    filter.sortBy = prop || 'createdAt';
    filter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
    return loadFirstPage();
  }

  async function filterByTag(tag: NamedOption) {
    filter.tagId = tag.id;
    await loadFirstPage();
  }

  async function filterByKnowledgePoint(point: NamedOption) {
    if (point.courseId && filter.courseId !== point.courseId) {
      filter.courseId = point.courseId;
      await loadFilterKnowledgeTree();
    }
    filter.knowledgePointId = point.id;
    await loadFirstPage();
  }

  function handleSizeChange(size: number) {
    pagination.pageSize = size;
    pagination.page = 1;
    load();
  }

  function handleCurrentChange(page: number) {
    pagination.page = page;
    load();
  }

  return {
    loadCourses,
    loadFormKnowledgeTree,
    loadFilterKnowledgeTree,
    handleFormCourseChange,
    loadMaterialCandidates,
    addMaterialChild,
    removeMaterialChild,
    isMaterialCandidateDisabled,
    handleFilterCourseChange,
    loadTags,
    load,
    refreshAll,
    loadFirstPage,
    handleQuestionSortChange,
    filterByTag,
    filterByKnowledgePoint,
    handleSizeChange,
    handleCurrentChange,
  };
}
