<template>
  <div v-loading="loading" class="scratch-classroom" data-testid="scratch-classroom-panel">
    <el-alert
      title="Scratch 模板、学生作品版本、教师批阅和判定记录均独立留痕；归档任务不会删除历史数据。"
      type="info"
      :closable="false"
      show-icon
    />

    <section class="scratch-section">
      <div class="section-head"><h3>模板库</h3><span class="muted">仅接受结构校验通过的 .sb3 文件</span></div>
      <div class="form-row">
        <el-input v-model="templateForm.title" placeholder="模板名称" />
        <el-input v-model="templateForm.description" placeholder="模板说明（可选）" />
        <el-upload accept=".sb3" :auto-upload="false" :show-file-list="false" :limit="1" :on-change="selectTemplateProject">
          <el-button data-testid="select-scratch-template">选择 .sb3</el-button>
        </el-upload>
        <span class="file-name">{{ templateProject?.name || '未选择文件' }}</span>
        <el-button data-testid="create-scratch-template" type="primary" :loading="saving" @click="addTemplate">创建模板</el-button>
      </div>
      <el-table :data="templates" size="small" max-height="220">
        <el-table-column prop="title" label="模板" min-width="180" />
        <el-table-column label="文件" min-width="190"><template #default="{ row }">{{ row.project.fileName }}</template></el-table-column>
        <el-table-column prop="assignmentCount" label="已绑定" width="80" />
        <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '可用' : '已归档' }}</el-tag></template></el-table-column>
      </el-table>
    </section>

    <section class="scratch-section">
      <div class="section-head"><h3>绑定课次任务</h3><span class="muted">发布后学生端可见</span></div>
      <div class="assignment-form">
        <el-select v-model="assignmentForm.templateId" placeholder="选择模板" filterable>
          <el-option v-for="item in activeTemplates" :key="item.id" :label="item.title" :value="item.id" />
        </el-select>
        <el-input v-model="assignmentForm.title" data-testid="scratch-assignment-title" placeholder="任务名称" />
        <el-input-number v-model="assignmentForm.maxScore" :min="1" :max="1000" controls-position="right" />
        <el-select v-model="assignmentForm.judgeMode">
          <el-option label="教师人工批阅" value="manual" />
          <el-option label="仅收集作品" value="none" />
          <el-option label="外部自动判定" value="external" />
        </el-select>
        <el-button data-testid="create-scratch-assignment" type="primary" :loading="saving" @click="addAssignment">绑定任务</el-button>
        <el-input v-model="assignmentForm.statementMd" class="statement" type="textarea" :rows="2" placeholder="任务说明（可选）" />
      </div>
    </section>

    <section class="scratch-section">
      <div class="section-head"><h3>本课次任务与作品</h3><el-button link type="primary" @click="load">刷新</el-button></div>
      <el-empty v-if="!assignments.length" description="本课次尚未绑定 Scratch 任务" :image-size="72" />
      <el-collapse v-else data-testid="scratch-assignment-list">
        <el-collapse-item v-for="assignment in assignments" :key="assignment.id" :name="assignment.id">
          <template #title>
            <div class="assignment-title">
              <strong>{{ assignment.title }}</strong>
              <el-tag :type="statusType(assignment.status)" size="small">{{ statusText(assignment.status) }}</el-tag>
              <span class="muted">{{ assignment.template.title }} · {{ judgeText(assignment.judgeMode) }} · {{ assignment.workCount || 0 }} 份作品</span>
            </div>
          </template>
          <div class="assignment-actions">
            <span>{{ assignment.statementMd || '未填写任务说明' }}</span>
            <div>
              <el-button v-if="assignment.status === 'draft'" data-testid="publish-scratch-assignment" size="small" type="success" @click="publish(assignment)">发布</el-button>
              <el-button v-if="assignment.status !== 'archived'" size="small" type="danger" plain @click="archive(assignment)">归档</el-button>
            </div>
          </div>
          <el-table :data="assignment.works" size="small" data-testid="scratch-work-table">
            <el-table-column label="学生" min-width="140"><template #default="{ row }">{{ personName(row.student) }}</template></el-table-column>
            <el-table-column prop="title" label="作品" min-width="180" />
            <el-table-column label="版本" width="90"><template #default="{ row }">v{{ row.currentVersion }}</template></el-table-column>
            <el-table-column label="状态" width="100"><template #default="{ row }">{{ workStatusText(row.status) }}</template></el-table-column>
            <el-table-column label="最近得分" width="100"><template #default="{ row }">{{ row.latestReview?.score ?? row.latestJudgeRun?.score ?? '-' }}</template></el-table-column>
            <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button data-testid="open-scratch-work" link type="primary" @click="openWork(row.id)">查看/批阅</el-button></template></el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </section>

    <el-drawer v-model="workVisible" data-testid="scratch-work-review-drawer" size="min(820px, 96vw)" title="Scratch 作品详情" append-to-body>
      <template v-if="work">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="学生">{{ personName(work.student) }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ workStatusText(work.status) }}</el-descriptions-item>
          <el-descriptions-item label="任务">{{ work.assignment.title }}</el-descriptions-item>
          <el-descriptions-item label="当前版本">v{{ work.currentVersion }}</el-descriptions-item>
        </el-descriptions>

        <h3>不可覆盖的版本历史</h3>
        <el-table :data="work.versions" size="small" data-testid="scratch-version-history">
          <el-table-column label="版本" width="80"><template #default="{ row }">v{{ row.version }}</template></el-table-column>
          <el-table-column label="来源" width="130"><template #default="{ row }">{{ sourceText(row.source) }}</template></el-table-column>
          <el-table-column prop="note" label="说明" min-width="180" />
          <el-table-column label="时间" width="180"><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></el-table-column>
          <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="primary" @click="downloadVersionRow(row)">下载</el-button></template></el-table-column>
        </el-table>

        <h3>判定记录</h3>
        <el-table :data="work.judgeRuns" size="small">
          <el-table-column prop="status" label="状态" width="120" />
          <el-table-column prop="score" label="得分" width="90" />
          <el-table-column prop="message" label="说明" min-width="200" />
          <el-table-column label="操作" width="100"><template #default="{ row }"><el-button v-if="['failed', 'retry'].includes(row.status)" link type="primary" @click="retryJudge(row.id)">重试</el-button></template></el-table-column>
        </el-table>

        <h3>新增批阅</h3>
        <div class="review-form">
          <el-input-number v-model="reviewForm.score" data-testid="scratch-review-score" :min="0" :max="work.assignment.maxScore" placeholder="评分" />
          <el-input v-model="reviewForm.comment" data-testid="scratch-review-comment" type="textarea" :rows="3" placeholder="教师点评" />
          <el-button data-testid="submit-scratch-review" type="primary" :loading="saving" @click="review">保存批阅</el-button>
        </div>
        <el-timeline class="review-history">
          <el-timeline-item v-for="item in work.reviews" :key="item.id" :timestamp="formatTime(item.createdAt)">
            <strong>{{ item.score === null ? '未评分' : `${item.score} 分` }}</strong><div>{{ item.comment || '无文字点评' }}</div>
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef, watch } from 'vue';
import { useScratchClassroom } from '../composables/useScratchClassroom';
import type { ScratchVersionView } from '../api';

const props = defineProps<{ sessionId: string }>();
const sessionId = toRef(props, 'sessionId');
const {
  addAssignment, addTemplate, archive, assignmentForm, assignments, downloadScratchVersion, load, loading,
  openWork, publish, review, reviewForm, retryJudge, saving, selectTemplateProject, templateForm,
  templateProject, templates, work, workVisible,
} = useScratchClassroom(sessionId);

const activeTemplates = computed(() => templates.value.filter((item) => item.status === 'active'));
watch(sessionId, () => void load(), { immediate: true });

const statusText = (status: string) => ({ draft: '草稿', published: '已发布', archived: '已归档' }[status] || status);
const statusType = (status: string): 'info' | 'success' | 'warning' => ({ published: 'success', archived: 'info' }[status] || 'warning') as 'info' | 'success' | 'warning';
const judgeText = (mode: string) => ({ manual: '人工批阅', external: '外部判定', none: '不判定' }[mode] || mode);
const workStatusText = (status: string) => ({ draft: '草稿', submitted: '已提交', reviewed: '已批阅' }[status] || status);
const sourceText = (source: string) => ({ template_copy: '模板副本', student_save: '学生保存', submission: '提交固化', import: '历史迁移' }[source] || source);
const personName = (person?: { realName: string | null; username: string }) => person ? person.realName || person.username : '-';
const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const downloadVersionRow = (row: unknown) => downloadScratchVersion(row as ScratchVersionView);
</script>

<style scoped>
.scratch-classroom { min-height: 360px; }
.scratch-section { margin-top: 18px; }
.section-head, .assignment-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-head h3 { margin: 0; }
.form-row { display: grid; grid-template-columns: 180px minmax(180px, 1fr) auto minmax(110px, auto) auto; gap: 10px; align-items: center; margin: 12px 0; }
.file-name { color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assignment-form { display: grid; grid-template-columns: 180px minmax(180px, 1fr) 130px 150px auto; gap: 10px; margin: 12px 0; }
.assignment-form .statement { grid-column: 1 / -1; }
.assignment-title { display: flex; gap: 10px; align-items: center; min-width: 0; }
.assignment-actions { padding-bottom: 10px; }
.review-form { display: grid; grid-template-columns: 160px 1fr auto; gap: 12px; align-items: start; }
.review-history { margin-top: 20px; }
@media (max-width: 760px) {
  .form-row, .assignment-form, .review-form { grid-template-columns: 1fr; }
  .assignment-form .statement { grid-column: auto; }
  .assignment-title { flex-wrap: wrap; }
}
</style>
