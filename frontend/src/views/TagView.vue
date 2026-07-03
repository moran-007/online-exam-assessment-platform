<template>
  <div class="page library-page">
    <div class="page-head">
      <h1 class="page-title">标签管理</h1>
      <div class="toolbar">
        <el-input v-model="keyword" clearable placeholder="标签关键词" style="width: 220px" @keyup.enter="loadFirstPage" @clear="loadFirstPage" />
        <el-select v-model="typeFilter" clearable placeholder="类型" style="width: 130px" @change="loadFirstPage">
          <el-option v-for="type in tagTypes" :key="type.value" :label="type.label" :value="type.value" />
        </el-select>
        <el-select v-model="statusFilter" clearable placeholder="状态" style="width: 130px" @change="loadFirstPage">
          <el-option label="启用" value="ACTIVE" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreateDialog">新增标签</el-button>
      </div>
    </div>

    <section class="library-summary">
      <div class="mini-metric">
        <span>标签总数</span>
        <strong>{{ pagination.total }}</strong>
      </div>
      <div class="mini-metric">
        <span>题目标签</span>
        <strong>{{ countByType('QUESTION') }}</strong>
      </div>
      <div class="mini-metric">
        <span>试卷/考试</span>
        <strong>{{ countByType('PAPER') + countByType('EXAM') }}</strong>
      </div>
      <div class="mini-metric wide">
        <span>维护提示</span>
        <strong>删除标签只解除关联，不会删除题目</strong>
      </div>
    </section>

    <section class="panel library-table-panel">
      <el-table
        :data="items"
        height="100%"
        highlight-current-row
        @row-click="openEditDialog"
      >
        <el-table-column label="标签" min-width="260">
          <template #default="{ row }">
            <div class="library-title-cell">
              <strong>{{ row.name }}</strong>
              <small>{{ row.code }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">{{ typeLabel(row.type) }}</template>
        </el-table-column>
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
              <el-dropdown trigger="click" @command="(command) => handleTagCommand(row, command)">
                <el-button size="small" @click.stop>操作</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">编辑</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-footer">
        <span class="muted">共 {{ pagination.total }} 个标签</span>
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

    <el-dialog v-model="formDialogVisible" :title="editingId ? '编辑标签' : '新增标签'" width="560px" destroy-on-close @closed="resetForm">
      <el-form :model="form" label-width="84px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="例如：循环、数组、模拟题" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option v-for="type in tagTypes" :key="type.value" :label="type.label" :value="type.value" />
          </el-select>
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
              <el-input v-model="form.code" placeholder="留空则系统自动生成" />
            </el-form-item>
          </el-collapse-item>
        </el-collapse>
      </el-form>
      <template #footer>
        <el-button @click="formDialogVisible = false">取消</el-button>
        <el-button type="primary" :icon="editingId ? Edit : Plus" @click="save">
          {{ editingId ? '保存标签' : '新增标签' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Edit, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

const { showMediumColumns } = useResponsiveColumns();
const tagTypes = [
  { label: '题目', value: 'QUESTION' },
  { label: '试卷', value: 'PAPER' },
  { label: '考试', value: 'EXAM' },
  { label: '自定义', value: 'CUSTOM' },
];

const items = ref([]);
const keyword = ref('');
const typeFilter = ref('');
const statusFilter = ref('');
const editingId = ref('');
const formDialogVisible = ref(false);
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const form = reactive(baseForm());

const pageTypeCounts = computed(() =>
  items.value.reduce((map, item) => {
    map[item.type] = (map[item.type] || 0) + 1;
    return map;
  }, {}),
);

function baseForm() {
  return { name: '', code: '', type: 'QUESTION', status: 'ACTIVE' };
}

async function load() {
  const data = await api(`/tags${buildQuery({
    page: pagination.page,
    pageSize: pagination.pageSize,
    keyword: keyword.value,
    type: typeFilter.value,
    status: statusFilter.value,
  })}`);
  items.value = data.items;
  pagination.page = data.page;
  pagination.pageSize = data.pageSize;
  pagination.total = data.total;
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
    type: row.type,
    status: row.status,
  });
  formDialogVisible.value = true;
}

function handleTagCommand(row, command) {
  if (command === 'edit') return openEditDialog(row);
  if (command === 'delete') return remove(row);
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.error('请填写标签名称');
    return;
  }

  const payload = {
    name: form.name.trim(),
    code: form.code.trim() || makeEntityCode(form.name),
    type: form.type,
    status: form.status,
  };

  if (editingId.value) {
    await api(`/tags/${editingId.value}`, { method: 'PATCH', body: payload });
    ElMessage.success('标签已保存');
  } else {
    const createPayload = { ...payload };
    delete createPayload.status;
    await api('/tags', { method: 'POST', body: createPayload });
    ElMessage.success('已新增标签');
  }

  formDialogVisible.value = false;
  resetForm();
  await load();
}

function resetForm() {
  editingId.value = '';
  Object.assign(form, baseForm());
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除标签“${row.name}”？题目不会被删除，只会少一个标签。`, '删除标签', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await api(`/tags/${row.id}`, { method: 'DELETE' });
    ElMessage.success('标签已删除');
    if (editingId.value === row.id) resetForm();
    await load();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
}

function countByType(type) {
  return pageTypeCounts.value[type] || 0;
}

function typeLabel(value) {
  return tagTypes.find((item) => item.value === value)?.label ?? value ?? '';
}

function makeEntityCode(value) {
  const ascii = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return `tag_${ascii || 'custom'}_${Date.now()}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

onMounted(load);
</script>
