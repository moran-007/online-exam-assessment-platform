<template>
  <div class="page knowledge-page">
    <div class="page-head">
      <h1 class="page-title">课程知识点管理</h1>
      <div class="toolbar">
        <el-select v-model="courseId" filterable placeholder="选择课程" style="width: 260px" @change="onCourseChange">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-button type="primary" :icon="Upload" @click="openKnowledgeImportDialog">批量导入知识点</el-button>
        <el-button :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <div class="knowledge-workspace">
      <aside class="panel knowledge-course-rail">
        <div class="knowledge-rail-head">
          <div>
            <h3>课程</h3>
            <span class="muted">共 {{ courseGroups.length }} 门课程</span>
          </div>
          <el-tag type="info">{{ selectedCount }} 个知识点</el-tag>
        </div>
        <el-input v-model="courseKeyword" clearable placeholder="搜索课程" />
        <div class="knowledge-course-list">
          <button
            v-for="group in visibleCourseGroups"
            :key="group.course.id"
            class="knowledge-course-item"
            :class="{ active: group.course.id === courseId }"
            type="button"
            @click="selectCourse(group.course.id)"
          >
            <span>
              <strong>{{ group.course.name }}</strong>
              <small>{{ group.course.code || '系统课程' }}</small>
            </span>
            <el-tag size="small" :type="group.count ? 'success' : 'info'" effect="plain">{{ group.count }}</el-tag>
          </button>
        </div>
      </aside>

      <section class="panel knowledge-main-panel">
        <div class="knowledge-main-head">
          <div>
            <h3>{{ currentCourse?.name || '课程知识点' }}</h3>
            <span class="muted">知识点是课程下的细分目录，可继续创建多级子知识点</span>
          </div>
          <div class="toolbar">
            <el-button :icon="Plus" @click="openCreateKnowledge()">新增一级</el-button>
          </div>
        </div>
        <div class="knowledge-tree-shell">
          <el-tree
            v-if="treeOptions.length"
            :data="treeOptions"
            node-key="value"
            default-expand-all
            class="knowledge-tree"
          >
            <template #default="{ data }">
              <span class="knowledge-node">
                <span class="knowledge-node-main">
                  <strong>{{ data.raw.name }}</strong>
                  <small>{{ data.raw.code || '自动编码' }} · 排序 {{ data.raw.sortOrder ?? 0 }}</small>
                </span>
                <span class="knowledge-node-actions">
                  <el-button size="small" link :icon="Plus" @click.stop="openCreateKnowledge(data.raw)">添加子级</el-button>
                  <el-button size="small" link :icon="Edit" @click.stop="openEditKnowledge(data.raw)">编辑</el-button>
                  <el-button size="small" link type="danger" :icon="Delete" @click.stop="removeKnowledge(data.raw)">
                    删除
                  </el-button>
                </span>
              </span>
            </template>
          </el-tree>
          <el-empty v-else description="当前课程暂无知识点">
            <el-button type="primary" :icon="Plus" @click="openCreateKnowledge()">新增知识点</el-button>
          </el-empty>
        </div>
      </section>
    </div>

    <el-dialog v-model="formDialogVisible" :title="editingId ? '编辑知识点' : '新增知识点'" width="560px" destroy-on-close>
      <el-form :model="form" label-width="84px">
        <el-form-item label="课程">
          <el-select v-model="courseId" filterable style="width: 100%" @change="onCourseChange">
            <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="例如：1. 分支结构" />
        </el-form-item>
        <el-form-item label="父级">
          <el-tree-select
            v-model="form.parentId"
            :data="treeOptions"
            check-strictly
            clearable
            placeholder="不选则作为课程下一级知识点"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" />
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model="form.code" placeholder="留空自动生成，通常无需填写" />
        </el-form-item>
        <el-form-item v-if="editingId" label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用" value="ACTIVE" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formDialogVisible = false">取消</el-button>
        <el-button type="primary" :icon="editingId ? Edit : Plus" @click="saveKnowledge">
          {{ editingId ? '保存知识点' : '新增知识点' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" title="批量导入知识点" width="980px" destroy-on-close>
      <div class="paper-preview-head">
        <div>
          <h2>知识点批量导入</h2>
          <span class="muted">先选择所属课程，再导入知识点模板；知识点编码由系统自动生成。</span>
        </div>
        <div class="toolbar">
          <el-button :icon="DocumentCopy" @click="loadBatchTemplate">加载模板</el-button>
          <el-button :icon="View" @click="previewBatch">解析预览</el-button>
          <el-button type="primary" :icon="Upload" :loading="importing" @click="importBatch">批量导入</el-button>
        </div>
      </div>
      <el-form label-width="84px" class="knowledge-import-form">
        <el-form-item label="所属课程">
          <el-select v-model="batchCourseId" filterable style="width: 100%" @change="previewBatch(false)">
            <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert v-if="batchErrorSummary" :title="batchErrorSummary" type="error" show-icon :closable="false" class="batch-alert" />
      <div class="course-import-grid">
        <el-input
          v-model="batchText"
          type="textarea"
          :rows="10"
          resize="vertical"
          placeholder="知识点名称 | 父级知识点名称 | 排序"
          @input="previewBatch(false)"
        />
        <el-table :data="batchPreview" height="300" :row-class-name="batchRowClass">
          <el-table-column prop="line" label="行" width="60" />
          <el-table-column prop="pointName" label="知识点名称" min-width="150" />
          <el-table-column prop="parentName" label="父级知识点" min-width="140" />
          <el-table-column prop="sortOrder" label="排序" width="80" />
          <el-table-column prop="pointCode" label="系统编码" min-width="130" />
          <el-table-column prop="statusText" label="导入状态" min-width="190" />
        </el-table>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Upload" :loading="importing" @click="importBatch">批量导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, DocumentCopy, Edit, Plus, Refresh, Upload, View } from '@element-plus/icons-vue';
import { api } from '../api';

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
const form = reactive({ name: '', code: '', parentId: null, sortOrder: 0, status: 'ACTIVE' });

const currentCourse = computed(() => courses.value.find((course) => course.id === courseId.value));
const currentTree = computed(() => courseTrees.value.find((group) => group.course.id === courseId.value)?.tree ?? []);
const treeOptions = computed(() => convertTree(currentTree.value));
const courseGroups = computed(() =>
  courseTrees.value.map((group) => ({
    ...group,
    options: convertTree(group.tree),
    count: countNodes(group.tree),
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

function convertTree(items) {
  return items.map((item) => ({
    label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
    value: item.id,
    raw: item,
    children: convertTree(item.children ?? []),
  }));
}

function countNodes(items) {
  return items.reduce((sum, item) => sum + 1 + countNodes(item.children ?? []), 0);
}

async function loadAll() {
  const data = await api('/courses?pageSize=100');
  courses.value = data.items;
  courseId.value = courseId.value || courses.value[0]?.id || '';
  batchCourseId.value = batchCourseId.value || courseId.value || courses.value[0]?.id || '';
  await loadAllTrees();
}

async function loadAllTrees() {
  const groups = await Promise.all(
    courses.value.map(async (course) => ({
      course,
      tree: await api(`/knowledge-points/tree?courseId=${course.id}`),
    })),
  );
  courseTrees.value = groups;
}

function onCourseChange() {
  form.parentId = null;
  if (!editingId.value) {
    form.code = '';
  }
}

function selectCourse(id) {
  courseId.value = id;
  onCourseChange();
}

function openCreateKnowledge(parent = null) {
  if (!courseId.value && courses.value[0]) {
    courseId.value = courses.value[0].id;
  }
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

  const generatedCode = form.code.trim() || nextManualPointCode(form.name, form.sortOrder);
  const payload = {
    parentId: form.parentId || null,
    name: form.name.trim(),
    code: generatedCode,
    sortOrder: Number(form.sortOrder || 0),
    status: form.status,
  };

  if (editingId.value) {
    await api(`/knowledge-points/${editingId.value}`, { method: 'PATCH', body: payload });
    ElMessage.success('知识点已保存');
  } else {
    const { status, ...createPayload } = payload;
    await api('/knowledge-points', {
      method: 'POST',
      body: {
        ...createPayload,
        courseId: courseId.value,
      },
    });
    ElMessage.success('已新增');
  }

  resetForm();
  formDialogVisible.value = false;
  await loadAllTrees();
}

function resetForm() {
  editingId.value = '';
  Object.assign(form, { name: '', code: '', parentId: null, sortOrder: 0, status: 'ACTIVE' });
}

async function removeKnowledge(point) {
  try {
    await ElMessageBox.confirm(`确认删除知识点“${point.name}”？会解除它与题目的关联；有子知识点时不能直接删除。`, '删除知识点', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await api(`/knowledge-points/${point.id}`, { method: 'DELETE' });
    ElMessage.success('知识点已删除');
    if (editingId.value === point.id) resetForm();
    await loadAllTrees();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
}

function openKnowledgeImportDialog() {
  batchCourseId.value = courseId.value || courses.value[0]?.id || '';
  importDialogVisible.value = true;
  previewBatch(false);
}

function loadBatchTemplate() {
  batchCodeSeed.value = Date.now();
  batchText.value = [
    '# 知识点名称 | 父级知识点名称 | 排序',
    '1. 分支结构 | | 1',
    '2. 循环结构 | | 2',
    'for 循环 | 2. 循环结构 | 1',
    'while 循环 | 2. 循环结构 | 2',
  ].join('\n');
  previewBatch();
}

function previewBatch(showMessage = true) {
  const result = parseKnowledgeBatch(batchText.value);
  batchPreview.value = result.rows;
  batchErrorSummary.value = result.errors.map((error) => `第 ${error.line} 行：${error.message}`).join('；');
  if (!showMessage) return;

  if (result.errors.length) {
    ElMessage.error('知识点模板存在问题，请查看预览');
  } else {
    ElMessage.success(`解析到 ${result.rows.length} 条数据`);
  }
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
      const nextPending = [];
      let progressed = false;

      for (const row of pending) {
        const parentId = row.parentName ? pointMap.get(row.parentName)?.id : null;
        if (row.parentName && !parentId) {
          nextPending.push(row);
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
            ? await api(`/knowledge-points/${existing.id}`, { method: 'PATCH', body: payload })
            : await api('/knowledge-points', {
                method: 'POST',
                body: { ...payload, courseId: selectedCourse.id },
              });
          pointMap.set(row.pointName, saved);
          row.statusText = existing ? '已更新知识点' : '已新增知识点';
          successCount += 1;
          progressed = true;
        } catch (error) {
          row.valid = false;
          row.statusText = error.message;
        }
      }

      if (!progressed && nextPending.length) {
        nextPending.forEach((row) => {
          row.valid = false;
          row.statusText = `父级知识点不存在：${row.parentName}`;
        });
        break;
      }

      pending = nextPending;
    }
  } finally {
    importing.value = false;
  }

  ElMessage.success(`成功处理 ${successCount} / ${validRows.length} 条数据`);
  importDialogVisible.value = false;
  await loadAll();
}

function parseKnowledgeBatch(text) {
  const rows = [];
  const errors = [];
  const selectedCourse = courses.value.find((course) => course.id === batchCourseId.value);
  const existingNames = buildPointNameSet(selectedCourse?.id);
  const generatedCodes = buildPointCodeSet(selectedCourse?.id);

  text.replace(/\r\n/g, '\n').split('\n').forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const parts = splitTemplateLine(line);
    if (isKnowledgeTemplateHeader(parts)) return;

    const [pointName = '', parentName = '', sortOrderText = '0'] = parts;
    const sortOrder = parseOrder(sortOrderText);
    const row = {
      line: lineNumber,
      pointName: pointName.trim(),
      parentName: parentName.trim(),
      sortOrder,
      pointCode: nextPointCode(pointName, sortOrder, lineNumber, generatedCodes),
      valid: true,
      statusText: '待导入',
    };
    rows.push(row);
  });

  validateKnowledgeRows(rows, errors, selectedCourse, existingNames);
  return { rows, errors };
}

function validateKnowledgeRows(rows, errors, selectedCourse, existingNames) {
  const plannedNames = new Set(rows.map((row) => row.pointName).filter(Boolean));
  const seenNames = new Set();

  rows.forEach((row) => {
    const rowErrors = [];
    if (!selectedCourse) rowErrors.push('请先选择所属课程');
    if (!Number.isFinite(row.sortOrder) || row.sortOrder < 0) rowErrors.push('排序必须是大于等于 0 的数字');
    if (!row.pointName) rowErrors.push('请填写知识点名称');
    if (seenNames.has(row.pointName)) rowErrors.push('知识点名称在本次导入中重复');
    if (row.parentName && row.parentName === row.pointName) rowErrors.push('父级知识点不能是自己');
    if (row.parentName && !existingNames.has(row.parentName) && !plannedNames.has(row.parentName)) {
      rowErrors.push(`父级知识点不存在：${row.parentName}`);
    }
    seenNames.add(row.pointName);
    if (!rowErrors.length) {
      row.statusText = existingNames.has(row.pointName) ? '将更新知识点' : '将新增知识点';
    }

    if (rowErrors.length) {
      row.valid = false;
      row.statusText = rowErrors.join('；');
      errors.push({ line: row.line, message: row.statusText });
    }
  });
}

function splitTemplateLine(line) {
  return (line.includes('|') ? line.split('|') : line.split(',')).map((item) => item.trim());
}

function isKnowledgeTemplateHeader(parts) {
  const first = String(parts[0] || '').trim().toLowerCase();
  return ['知识点名称', '名称', 'name'].includes(first);
}

function parseOrder(value) {
  const match = String(value || '0').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function buildPointNameSet(selectedCourseId) {
  return new Set(flattenSelectedCourseTree(selectedCourseId).map((item) => item.name));
}

function buildPointCodeSet(selectedCourseId) {
  return new Set(flattenSelectedCourseTree(selectedCourseId).map((item) => item.code));
}

function buildPointNameMap(selectedCourseId) {
  return new Map(flattenSelectedCourseTree(selectedCourseId).map((item) => [item.name, item]));
}

function flattenSelectedCourseTree(selectedCourseId) {
  const group = courseTrees.value.find((item) => item.course.id === selectedCourseId);
  return flattenKnowledgePoints(group?.tree ?? []);
}

function nextPointCode(name, sortOrder, lineNumber, usedCodes) {
  const base = makeCodeBase(name) || `kp_${sortOrder || lineNumber}`;
  let code = `${base}_${batchCodeSeed.value}_${lineNumber}`;
  let index = 1;
  while (usedCodes.has(code)) {
    code = `${base}_${batchCodeSeed.value}_${lineNumber}_${index++}`;
  }
  usedCodes.add(code);
  return code;
}

function makeCodeBase(value) {
  const ascii = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return ascii || 'kp';
}

function nextManualPointCode(name, sortOrder) {
  const selectedCourseCode = currentCourse.value?.code || 'course';
  const base = makeCodeBase(`${selectedCourseCode}_${name}`) || 'kp';
  const suffix = `${Date.now()}_${Number(sortOrder || 0)}`;
  return `${base}_${suffix}`.slice(0, 64);
}

function flattenKnowledgePoints(items) {
  return items.flatMap((item) => [item, ...flattenKnowledgePoints(item.children ?? [])]);
}

function batchRowClass({ row }) {
  return row.valid === false ? 'batch-row-error' : '';
}

onMounted(loadAll);
</script>
