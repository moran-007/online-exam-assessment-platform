<template>
  <div class="knowledge-page" :class="{ page: !embedded, 'knowledge-page--embedded': embedded }">
    <div class="page-head">
      <h1 class="page-title">课程知识点管理</h1>
      <div class="toolbar">
        <el-select v-model="courseId" filterable placeholder="选择课程" style="width: 260px" @change="onCourseChange">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-button v-if="canCreateKnowledge && canUpdateKnowledge" type="primary" :icon="Upload" @click="openKnowledgeImportDialog">批量导入知识点</el-button>
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
            <el-button v-if="canCreateKnowledge" :icon="Plus" @click="openCreateKnowledge()">新增一级</el-button>
          </div>
        </div>
        <div class="knowledge-tree-shell">
          <div v-if="treeOptions.length" class="knowledge-tree-header" aria-hidden="true">
            <span>知识点</span>
            <span>教案状态</span>
            <span>教案入口</span>
            <span>知识点管理</span>
          </div>
          <el-tree v-if="treeOptions.length" :data="treeOptions" node-key="value" default-expand-all class="knowledge-tree">
            <template #default="{ data }">
              <span class="knowledge-node">
                <span class="knowledge-node-main">
                  <strong>{{ data.raw.name }}</strong>
                  <small>{{ data.raw.code || '自动编码' }} · 排序 {{ data.raw.sortOrder ?? 0 }}</small>
                </span>
                <span class="knowledge-node-status">
                  <el-tag size="small" :type="lessonPlanMeta(data.raw.id).type" effect="plain">
                    {{ lessonPlanMeta(data.raw.id).label }}
                  </el-tag>
                </span>
                <span class="knowledge-node-entry">
                  <el-button link type="primary" @click.stop="openLessonPlan(data.raw)">
                    {{ lessonPlanMeta(data.raw.id).plan ? `查看 ${lessonPlanMeta(data.raw.id).count} 份` : '创建教案' }}
                  </el-button>
                </span>
                <span class="knowledge-node-actions">
                  <el-button v-if="canCreateKnowledge" size="small" link :icon="Plus" @click.stop="openCreateKnowledge(data.raw)">添加子级</el-button>
                  <el-button v-if="canUpdateKnowledge" size="small" link :icon="Edit" @click.stop="openEditKnowledge(data.raw)">编辑</el-button>
                  <el-button v-if="canUpdateKnowledge" size="small" link type="danger" :icon="Delete" @click.stop="removeKnowledge(data.raw)">
                    删除
                  </el-button>
                </span>
              </span>
            </template>
          </el-tree>
          <el-empty v-else description="当前课程暂无知识点">
            <el-button v-if="canCreateKnowledge" type="primary" :icon="Plus" @click="openCreateKnowledge()">新增知识点</el-button>
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
import { Delete, DocumentCopy, Edit, Plus, Refresh, Upload, View } from '@element-plus/icons-vue';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { getCurrentUser } from '../../../api';
import { hasAnyPermission } from '../../../access';
import { isLessonPlanReady, useLessonPlanCatalog } from '../../lesson-records/composables/useLessonPlanCatalog';
import { useKnowledgeManagementPage } from '../composables/useKnowledgeManagementPage';

defineProps({
  embedded: { type: Boolean, default: false },
});

const currentUser = getCurrentUser();
const router = useRouter();
const canCreateKnowledge = hasAnyPermission(currentUser, ['knowledge-point:create']);
const canUpdateKnowledge = hasAnyPermission(currentUser, ['knowledge-point:update']);
const { plans, load: loadLessonPlans } = useLessonPlanCatalog();
const {
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
} = useKnowledgeManagementPage();

const lessonPlanMetaMap = computed(() => {
  const result = new Map();
  plans.value.forEach((plan) => {
    if (!plan.knowledgePointId) return;
    const current = result.get(plan.knowledgePointId) || [];
    current.push(plan);
    result.set(plan.knowledgePointId, current);
  });
  result.forEach((items, knowledgePointId) => {
    items.sort((left, right) => {
      const leftMine = left.source === 'PERSONAL' && left.authorId === currentUser?.id;
      const rightMine = right.source === 'PERSONAL' && right.authorId === currentUser?.id;
      return Number(rightMine) - Number(leftMine) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
    result.set(knowledgePointId, {
      plans: items,
      plan: items[0],
      complete: items.some(isLessonPlanReady),
    });
  });
  return result;
});

onMounted(() => {
  void loadLessonPlans().catch(() => undefined);
});

function lessonPlanMeta(knowledgePointId) {
  const meta = lessonPlanMetaMap.value.get(knowledgePointId);
  if (!meta) return { label: '未创建', type: 'info', plan: null, count: 0 };
  return {
    label: `${meta.plans.length} 份 · ${meta.complete ? '已完成' : '待完善'}`,
    type: meta.complete ? 'success' : 'warning',
    plan: meta.plan,
    count: meta.plans.length,
  };
}

function openLessonPlan(point) {
  const plan = lessonPlanMeta(point.id).plan;
  router.push({
    path: '/courses',
    query: {
      section: 'lesson-plans',
      courseId: point.courseId || courseId.value,
      knowledgePointId: point.id,
      ...(plan ? { planId: plan.id } : {}),
    },
  });
}
</script>
