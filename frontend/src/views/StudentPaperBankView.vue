<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">试卷题库</h1>
        <span class="muted">展示当前可练习的公开试卷</span>
      </div>
      <div class="toolbar">
        <el-input
          v-model="filter.keyword"
          clearable
          placeholder="试卷 / 课程关键词"
          style="width: 240px"
          @keyup.enter="loadFirstPage"
          @clear="loadFirstPage"
        />
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="panel question-table-panel">
      <el-table
        class="question-list-table"
        :data="items"
        height="100%"
        :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
        highlight-current-row
        @sort-change="handleSortChange"
      >
        <el-table-column prop="name" label="试卷" min-width="260" sortable="custom">
          <template #default="{ row }">
            <div class="question-title-cell">
              <strong>{{ row.name }}</strong>
              <span class="muted">{{ typeLabel(row.type) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="160" />
        <el-table-column prop="questionCount" label="题数" width="86" sortable="custom" />
        <el-table-column v-if="showMediumColumns" prop="totalScore" label="总分" width="88" sortable="custom" />
        <el-table-column prop="durationMinutes" label="时长" width="100" sortable="custom">
          <template #default="{ row }">{{ row.durationMinutes }} 分钟</template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" prop="updatedAt" label="更新时间" width="180" sortable="custom">
          <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" :icon="EditPen" @click="startPractice(row)">
              做题
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-footer">
        <span class="muted">共 {{ pagination.total }} 套可练习试卷</span>
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
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { EditPen, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

const router = useRouter();
const { showMediumColumns } = useResponsiveColumns();
const items = ref([]);
const filter = reactive({
  keyword: '',
  sortBy: 'updatedAt',
  sortOrder: 'desc',
});
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];

async function load() {
  const data = await api(
    `/student/papers${buildQuery({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filter.keyword,
      sortBy: filter.sortBy,
      sortOrder: filter.sortOrder,
    })}`,
  );
  items.value = data.items;
  pagination.page = data.page;
  pagination.pageSize = data.pageSize;
  pagination.total = data.total;
}

function loadFirstPage() {
  pagination.page = 1;
  return load();
}

function handleSortChange({ prop, order }) {
  filter.sortBy = prop || 'updatedAt';
  filter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  return loadFirstPage();
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

function startPractice(row) {
  router.push({
    path: `/papers/${row.id}/answer`,
    query: { return: '/student/papers' },
  });
}

function typeLabel(value) {
  const map = {
    fixed: '固定试卷',
    random: '随机试卷',
    rule: '规则组卷',
    practice: '练习卷',
  };
  return map[value] ?? value;
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

onMounted(load);
</script>
