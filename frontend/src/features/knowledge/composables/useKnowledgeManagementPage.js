import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  createKnowledgePoint,
  getKnowledgeTree,
  listCourses,
  removeKnowledgePoint,
  updateKnowledgePoint,
} from '../../platform/api';
import { KNOWLEDGE_BATCH_TEMPLATE, parseKnowledgeBatch } from './knowledge-batch';
import {
  convertKnowledgeTree,
  countKnowledgeNodes,
  flattenKnowledgePoints,
  makeKnowledgeCodeBase,
} from './knowledge-tree';

export function useKnowledgeManagementPage() {
  const courses = ref([]);
  const courseId = ref('');
  const courseTrees = ref([]);
  const courseKeyword = ref('');
  const editingId = ref('');
  const formDialogVisible = ref(false);
  const importDialogVisible = ref(false);
  const batchCourseId = ref('');
  const batchText = ref('');
  const batchPreview = ref([]);
  const batchErrorSummary = ref('');
  const importing = ref(false);
  const batchCodeSeed = ref(Date.now());
  const form = reactive(baseKnowledgeForm());

  const currentCourse = computed(() => courses.value.find((course) => course.id === courseId.value));
  const currentTree = computed(() => courseTrees.value.find((group) => group.course.id === courseId.value)?.tree ?? []);
  const treeOptions = computed(() => convertKnowledgeTree(currentTree.value));
  const courseGroups = computed(() =>
    courseTrees.value.map((group) => ({
      ...group,
      options: convertKnowledgeTree(group.tree),
      count: countKnowledgeNodes(group.tree),
    })),
  );
  const visibleCourseGroups = computed(() => {
    const keyword = courseKeyword.value.trim().toLowerCase();
    if (!keyword) return courseGroups.value;
    return courseGroups.value.filter((group) => {
      const name = group.course.name.toLowerCase();
      const code = String(group.course.code || '').toLowerCase();
      return name.includes(keyword) || code.includes(keyword);
    });
  });
  const selectedCount = computed(() => courseGroups.value.find((group) => group.course.id === courseId.value)?.count ?? 0);

  async function loadAll() {
    const data = await listCourses({ pageSize: 100 });
    courses.value = data.items;
    courseId.value = courseId.value || courses.value[0]?.id || '';
    batchCourseId.value = batchCourseId.value || courseId.value || courses.value[0]?.id || '';
    await loadAllTrees();
  }

  async function loadAllTrees() {
    courseTrees.value = await Promise.all(
      courses.value.map(async (course) => ({
        course,
        tree: await getKnowledgeTree(course.id),
      })),
    );
  }

  function onCourseChange() {
    form.parentId = null;
    if (!editingId.value) form.code = '';
  }

  function selectCourse(id) {
    courseId.value = id;
    onCourseChange();
  }

  function openCreateKnowledge(parent = null) {
    if (!courseId.value && courses.value[0]) courseId.value = courses.value[0].id;
    resetForm();
    form.parentId = parent?.id ?? null;
    form.sortOrder = parent?.children?.length ? parent.children.length + 1 : selectedCount.value + 1;
    formDialogVisible.value = true;
  }

  function openEditKnowledge(point) {
    editingId.value = point.id;
    courseId.value = point.courseId;
    Object.assign(form, {
      name: point.name,
      code: point.code,
      parentId: point.parentId,
      sortOrder: point.sortOrder,
      status: point.status,
    });
    formDialogVisible.value = true;
  }

  async function saveKnowledge() {
    if (!courseId.value) {
      ElMessage.error('请选择课程');
      return;
    }
    if (!form.name.trim()) {
      ElMessage.error('请填写知识点名称');
      return;
    }

    const payload = {
      parentId: form.parentId || null,
      name: form.name.trim(),
      code: form.code.trim() || nextManualPointCode(form.name, form.sortOrder),
      sortOrder: Number(form.sortOrder || 0),
      status: form.status,
    };

    if (editingId.value) {
      await updateKnowledgePoint(editingId.value, payload);
      ElMessage.success('知识点已保存');
    } else {
      const createPayload = { ...payload };
      delete createPayload.status;
      await createKnowledgePoint({ ...createPayload, courseId: courseId.value });
      ElMessage.success('已新增');
    }

    resetForm();
    formDialogVisible.value = false;
    await loadAllTrees();
  }

  function resetForm() {
    editingId.value = '';
    Object.assign(form, baseKnowledgeForm());
  }

  async function removeKnowledge(point) {
    try {
      await ElMessageBox.confirm(
        `确认删除知识点“${point.name}”？会解除它与题目的关联；有子知识点时不能直接删除。`,
        '删除知识点',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      );
      await removeKnowledgePoint(point.id);
      ElMessage.success('知识点已删除');
      if (editingId.value === point.id) resetForm();
      await loadAllTrees();
    } catch (error) {
      if (error !== 'cancel') ElMessage.error(error.message || '删除失败');
    }
  }

  function openKnowledgeImportDialog() {
    batchCourseId.value = courseId.value || courses.value[0]?.id || '';
    importDialogVisible.value = true;
    previewBatch(false);
  }

  function loadBatchTemplate() {
    batchCodeSeed.value = Date.now();
    batchText.value = KNOWLEDGE_BATCH_TEMPLATE;
    previewBatch();
  }

  function previewBatch(showMessage = true) {
    const selectedCourse = courses.value.find((course) => course.id === batchCourseId.value);
    const result = parseKnowledgeBatch({
      text: batchText.value,
      selectedCourse,
      existingPoints: flattenSelectedCourseTree(selectedCourse?.id),
      codeSeed: batchCodeSeed.value,
    });
    batchPreview.value = result.rows;
    batchErrorSummary.value = result.errors.map((error) => `第 ${error.line} 行：${error.message}`).join('；');
    if (!showMessage) return;
    if (result.errors.length) ElMessage.error('知识点模板存在问题，请查看预览');
    else ElMessage.success(`解析到 ${result.rows.length} 条数据`);
  }

  async function importBatch() {
    previewBatch(false);
    const validRows = batchPreview.value.filter((row) => row.valid !== false);
    if (!validRows.length || batchPreview.value.some((row) => row.valid === false)) {
      ElMessage.error('知识点模板未通过，请先修正错误');
      return;
    }
    const selectedCourse = courses.value.find((course) => course.id === batchCourseId.value);
    if (!selectedCourse) {
      ElMessage.error('请选择所属课程');
      return;
    }

    importing.value = true;
    let successCount = 0;
    try {
      const pointMap = buildPointNameMap(selectedCourse.id);
      let pending = [...validRows];
      while (pending.length) {
        const result = await importPendingRows(pending, selectedCourse.id, pointMap);
        successCount += result.successCount;
        if (!result.progressed && result.pending.length) {
          result.pending.forEach((row) => {
            row.valid = false;
            row.statusText = `父级知识点不存在：${row.parentName}`;
          });
          break;
        }
        pending = result.pending;
      }
    } finally {
      importing.value = false;
    }

    ElMessage.success(`成功处理 ${successCount} / ${validRows.length} 条数据`);
    importDialogVisible.value = false;
    await loadAll();
  }

  async function importPendingRows(rows, selectedCourseId, pointMap) {
    const pending = [];
    let successCount = 0;
    let progressed = false;
    for (const row of rows) {
      const parentId = row.parentName ? pointMap.get(row.parentName)?.id : null;
      if (row.parentName && !parentId) {
        pending.push(row);
        continue;
      }
      try {
        const existing = pointMap.get(row.pointName);
        const payload = {
          name: row.pointName,
          code: existing?.code || row.pointCode,
          parentId,
          sortOrder: row.sortOrder,
        };
        const saved = existing
          ? await updateKnowledgePoint(existing.id, payload)
          : await createKnowledgePoint({ ...payload, courseId: selectedCourseId });
        pointMap.set(row.pointName, saved);
        row.statusText = existing ? '已更新知识点' : '已新增知识点';
        successCount += 1;
        progressed = true;
      } catch (error) {
        row.valid = false;
        row.statusText = error.message;
      }
    }
    return { pending, successCount, progressed };
  }

  function flattenSelectedCourseTree(selectedCourseId) {
    const group = courseTrees.value.find((item) => item.course.id === selectedCourseId);
    return flattenKnowledgePoints(group?.tree ?? []);
  }

  function buildPointNameMap(selectedCourseId) {
    return new Map(flattenSelectedCourseTree(selectedCourseId).map((item) => [item.name, item]));
  }

  function nextManualPointCode(name, sortOrder) {
    const courseCode = currentCourse.value?.code || 'course';
    const base = makeKnowledgeCodeBase(`${courseCode}_${name}`);
    return `${base}_${Date.now()}_${Number(sortOrder || 0)}`.slice(0, 64);
  }

  function batchRowClass({ row }) {
    return row.valid === false ? 'batch-row-error' : '';
  }

  onMounted(loadAll);

  return {
    batchCourseId,
    batchErrorSummary,
    batchPreview,
    batchRowClass,
    batchText,
    courseGroups,
    courseId,
    courseKeyword,
    courses,
    currentCourse,
    editingId,
    form,
    formDialogVisible,
    importBatch,
    importDialogVisible,
    importing,
    loadAll,
    loadBatchTemplate,
    onCourseChange,
    openCreateKnowledge,
    openEditKnowledge,
    openKnowledgeImportDialog,
    previewBatch,
    removeKnowledge,
    saveKnowledge,
    selectCourse,
    selectedCount,
    treeOptions,
    visibleCourseGroups,
  };
}

function baseKnowledgeForm() {
  return { name: '', code: '', parentId: null, sortOrder: 0, status: 'ACTIVE' };
}
