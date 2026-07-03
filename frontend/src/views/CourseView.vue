<template>
  <div class="page library-page">
    <div class="page-head">
      <h1 class="page-title">课程管理</h1>
      <div class="toolbar">
        <el-input v-model="keyword" clearable placeholder="课程关键词" style="width: 220px" @keyup.enter="loadFirstPage" @clear="loadFirstPage" />
        <el-select v-model="statusFilter" clearable placeholder="状态" style="width: 130px" @change="loadFirstPage">
          <el-option label="启用" value="ACTIVE" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreateDialog">新增课程</el-button>
        <el-button :icon="Upload" @click="openImportDialog">批量导入课程</el-button>
      </div>
    </div>

    <section class="library-summary">
      <div class="mini-metric">
        <span>课程总数</span>
        <strong>{{ pagination.total }}</strong>
      </div>
      <div class="mini-metric">
        <span>本页启用</span>
        <strong>{{ activeCount }}</strong>
      </div>
      <div class="mini-metric">
        <span>本页停用</span>
        <strong>{{ disabledCount }}</strong>
      </div>
      <div class="mini-metric wide">
        <span>维护提示</span>
        <strong>编码自动生成，排序可按课程序号填写</strong>
      </div>
    </section>

    <section class="panel library-table-panel">
      <el-table
        :data="items"
        height="100%"
        highlight-current-row
        @row-click="openEditDialog"
      >
        <el-table-column label="课程" min-width="300">
          <template #default="{ row }">
            <div class="library-title-cell">
              <strong>{{ row.name }}</strong>
              <small>{{ row.description || '暂无课程说明' }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" prop="sortOrder" label="排序" width="90" />
        <el-table-column v-if="showLowColumns" prop="code" label="系统编码" min-width="180" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" prop="createdAt" label="创建时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <div class="question-actions row-action-cell" @click.stop @mousedown.stop>
              <el-dropdown trigger="click" @command="(command) => handleCourseCommand(row, command)">
                <el-button size="small" @click.stop>操作</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">编辑</el-dropdown-item>
                    <el-dropdown-item command="toggle">{{ row.status === 'ACTIVE' ? '停用' : '启用' }}</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-footer">
        <span class="muted">共 {{ pagination.total }} 门课程</span>
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            background
            size="small"
            :pager-count="5"
            layout="sizes, prev, pager, next"
          :page-sizes="pageSizes"
          :total="pagination.total"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </section>

    <el-dialog v-model="formDialogVisible" :title="editingId ? '编辑课程' : '新增课程'" width="620px" destroy-on-close @closed="resetForm">
      <el-form :model="form" label-width="84px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="例如：Python Basic" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" resize="vertical" placeholder="可选，写给教师维护时查看" />
        </el-form-item>
        <el-form-item label="封面">
          <el-input v-model="form.coverUrl" placeholder="可选，图片地址" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" />
          <span class="muted">可按第几节课设置</span>
        </el-form-item>
        <el-form-item v-if="editingId" label="状态">
          <el-select v-model="form.status" style="width: 180px">
            <el-option label="启用" value="ACTIVE" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-collapse class="advanced-collapse">
          <el-collapse-item title="高级信息" name="advanced">
            <el-form-item label="系统编码">
              <el-input v-model="form.code" :disabled="Boolean(editingId)" placeholder="留空则系统自动生成" />
            </el-form-item>
          </el-collapse-item>
        </el-collapse>
      </el-form>
      <template #footer>
        <el-button @click="formDialogVisible = false">取消</el-button>
        <el-button type="primary" :icon="editingId ? Edit : Plus" @click="save">
          {{ editingId ? '保存课程' : '新增课程' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" title="批量导入课程" width="980px" destroy-on-close>
      <div class="paper-preview-head">
        <div>
          <h2>课程批量导入</h2>
          <span class="muted">固定模板：课程名称 | 第几节课 | 描述；课程编码由系统自动生成。</span>
        </div>
        <div class="toolbar">
          <el-button :icon="DocumentCopy" @click="loadTemplate">加载模板</el-button>
          <el-button :icon="View" @click="previewBatch">解析预览</el-button>
          <el-button type="primary" :icon="Upload" :loading="importing" @click="importBatch">批量导入</el-button>
        </div>
      </div>
      <el-alert v-if="batchErrorSummary" :title="batchErrorSummary" type="error" show-icon :closable="false" class="batch-alert" />
      <div class="course-import-grid">
        <el-input
          v-model="batchText"
          type="textarea"
          :rows="8"
          resize="vertical"
          placeholder="示例：Python 进阶 | 1 | 面向进阶语法"
          @input="previewBatch(false)"
        />
        <el-table :data="batchPreview" height="220" :row-class-name="batchRowClass">
          <el-table-column prop="line" label="行" width="60" />
          <el-table-column prop="name" label="名称" min-width="160" />
          <el-table-column prop="sortOrder" label="第几节/排序" width="120" />
          <el-table-column prop="description" label="描述" min-width="180" />
          <el-table-column prop="code" label="系统编码" min-width="170" />
          <el-table-column prop="statusText" label="导入状态" min-width="180" />
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
import { DocumentCopy, Edit, Plus, Refresh, Search, Upload, View } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

const items = ref([]);
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const keyword = ref('');
const statusFilter = ref('');
const editingId = ref('');
const formDialogVisible = ref(false);
const importDialogVisible = ref(false);
const batchText = ref('');
const batchPreview = ref([]);
const batchErrorSummary = ref('');
const importing = ref(false);
const batchCodeSeed = ref(Date.now());
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const form = reactive(baseForm());

const activeCount = computed(() => items.value.filter((item) => item.status === 'ACTIVE').length);
const disabledCount = computed(() => items.value.filter((item) => item.status === 'DISABLED').length);

function baseForm() {
  return { name: '', code: '', description: '', coverUrl: '', sortOrder: 0, status: 'ACTIVE' };
}

async function load() {
  const data = await api(`/courses${buildQuery({
    page: pagination.page,
    pageSize: pagination.pageSize,
    keyword: keyword.value,
    status: statusFilter.value,
  })}`);
  items.value = data.items;
  pagination.page = data.page;
  pagination.pageSize = data.pageSize;
  pagination.total = data.total;
  previewBatch(false);
}

function loadFirstPage() {
  pagination.page = 1;
  return load();
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

function openCreateDialog() {
  resetForm();
  formDialogVisible.value = true;
}

function openEditDialog(row) {
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name,
    code: row.code,
    description: row.description ?? '',
    coverUrl: row.coverUrl ?? '',
    sortOrder: row.sortOrder,
    status: row.status,
  });
  formDialogVisible.value = true;
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.error('请填写课程名称');
    return;
  }

  const payload = {
    name: form.name.trim(),
    code: form.code.trim() || makeEntityCode(form.name, 'course'),
    description: form.description?.trim() || '',
    coverUrl: form.coverUrl?.trim() || '',
    sortOrder: Number(form.sortOrder || 0),
    status: form.status,
  };

  if (editingId.value) {
    const updatePayload = { ...payload };
    delete updatePayload.code;
    await api(`/courses/${editingId.value}`, { method: 'PATCH', body: updatePayload });
    ElMessage.success('课程已保存');
  } else {
    const createPayload = { ...payload };
    delete createPayload.status;
    await api('/courses', { method: 'POST', body: createPayload });
    ElMessage.success('已新增课程');
  }

  formDialogVisible.value = false;
  resetForm();
  await load();
}

function resetForm() {
  editingId.value = '';
  Object.assign(form, baseForm());
}

async function toggleStatus(row) {
  await api(`/courses/${row.id}`, {
    method: 'PATCH',
    body: { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
  });
  ElMessage.success('课程状态已更新');
  await load();
}

function handleCourseCommand(row, command) {
  if (command === 'edit') return openEditDialog(row);
  if (command === 'toggle') return toggleStatus(row);
  if (command === 'delete') return remove(row);
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除课程“${row.name}”？仅无知识点、题目、试卷、考试关联的课程可以删除。`, '删除课程', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await api(`/courses/${row.id}`, { method: 'DELETE' });
    ElMessage.success('课程已删除');
    if (editingId.value === row.id) resetForm();
    await load();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
}

function openImportDialog() {
  importDialogVisible.value = true;
  previewBatch(false);
}

function loadTemplate() {
  batchCodeSeed.value = Date.now();
  batchText.value = [
    '# 课程名称 | 第几节课 | 描述',
    'Python 进阶 | 1 | 面向进阶语法和代码阅读',
    'C++ 基础 | 2 | C++ 入门课程',
    'Scratch 创作 | 3 | 图形化编程项目课',
  ].join('\n');
  previewBatch();
}

function previewBatch(showMessage = true) {
  const result = parseCourseBatch(batchText.value);
  batchPreview.value = result.rows;
  batchErrorSummary.value = result.errors.map((error) => `第 ${error.line} 行：${error.message}`).join('；');
  if (!showMessage) return;

  if (result.errors.length) {
    ElMessage.error('课程模板存在问题，请查看预览');
  } else {
    ElMessage.success(`解析到 ${result.rows.length} 门课程`);
  }
}

async function importBatch() {
  previewBatch(false);
  const validRows = batchPreview.value.filter((row) => row.valid !== false);
  if (!validRows.length || batchPreview.value.some((row) => row.valid === false)) {
    ElMessage.error('课程模板未通过，请先修正错误');
    return;
  }

  importing.value = true;
  let successCount = 0;
  try {
    for (const row of validRows) {
      try {
        if (row.existingId) {
          await api(`/courses/${row.existingId}`, {
            method: 'PATCH',
            body: {
              name: row.name,
              description: row.description,
              sortOrder: row.sortOrder,
            },
          });
          row.statusText = '已更新';
        } else {
          await api('/courses', {
            method: 'POST',
            body: {
              name: row.name,
              code: row.code,
              description: row.description,
              sortOrder: row.sortOrder,
            },
          });
          row.statusText = '已导入';
        }
        successCount += 1;
      } catch (error) {
        row.valid = false;
        row.statusText = error.message;
      }
    }
  } finally {
    importing.value = false;
  }
  ElMessage.success(`成功导入 ${successCount} / ${validRows.length} 门课程`);
  importDialogVisible.value = false;
  await load();
}

function parseCourseBatch(text) {
  const rows = [];
  const errors = [];
  const seenNames = new Set();
  const existingByName = new Map(items.value.map((item) => [item.name, item]));
  const generatedCodes = new Set(items.value.map((item) => item.code));

  text.replace(/\r\n/g, '\n').split('\n').forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const parts = line.includes('|')
      ? line.split('|').map((item) => item.trim())
      : line.split(',').map((item) => item.trim());
    if (isCourseTemplateHeader(parts)) return;

    const [name = '', sortOrderText = '0', description = ''] = parts;
    const sortOrder = parseLessonOrder(sortOrderText);
    const existing = existingByName.get(name.trim());
    const row = {
      line: lineNumber,
      name: name.trim(),
      code: existing?.code || nextCourseCode(name, sortOrder, lineNumber, generatedCodes),
      existingId: existing?.id || '',
      sortOrder,
      description,
      valid: true,
      statusText: existing ? '将更新已有课程' : '待导入',
    };

    const message = validateCourseRow(row, seenNames);
    if (message) {
      row.valid = false;
      row.statusText = message;
      errors.push({ line: lineNumber, message });
    } else {
      seenNames.add(row.name);
    }
    rows.push(row);
  });

  return { rows, errors };
}

function validateCourseRow(row, seenNames) {
  if (!row.name) return '请填写课程名称';
  if (seenNames.has(row.name)) return '课程名称在本次导入中重复';
  if (!Number.isFinite(row.sortOrder) || row.sortOrder < 0) return '排序必须是大于等于 0 的数字';
  return '';
}

function isCourseTemplateHeader(parts) {
  return ['课程名称', '名称', 'name'].includes(String(parts[0] || '').trim().toLowerCase());
}

function parseLessonOrder(value) {
  const match = String(value || '0').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function nextCourseCode(name, sortOrder, lineNumber, usedCodes) {
  let code = `${makeCodeBase(name) || `course_${sortOrder || lineNumber}`}_${batchCodeSeed.value}_${lineNumber}`;
  let index = 1;
  while (usedCodes.has(code)) {
    code = `${makeCodeBase(name)}_${batchCodeSeed.value}_${lineNumber}_${index++}`;
  }
  usedCodes.add(code);
  return code;
}

function makeEntityCode(value, prefix) {
  return `${makeCodeBase(value) || prefix}_${Date.now()}`;
}

function makeCodeBase(value) {
  const ascii = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return ascii || 'course';
}

function batchRowClass({ row }) {
  return row.valid === false ? 'batch-row-error' : '';
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

onMounted(load);
</script>
