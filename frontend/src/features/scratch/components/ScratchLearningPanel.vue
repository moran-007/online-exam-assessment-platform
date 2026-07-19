<template>
  <div v-loading="loading" class="scratch-learning" data-testid="scratch-learning-panel">
    <el-alert
      :title="readonly ? '家长可查看已产生的作品版本、判定和教师点评，不能代替学生保存或提交。' : '每次保存都会创建新版本；提交会再固化一份提交版本，不会覆盖旧文件。'"
      type="info"
      :closable="false"
      show-icon
    />
    <div class="scratch-toolbar"><span class="muted">只显示教师已发布且属于当前学生班级的任务</span><el-button link type="primary" @click="load">刷新</el-button></div>
    <el-empty v-if="!assignments.length" description="暂无已发布的 Scratch 任务" />
    <div v-else class="assignment-grid" data-testid="student-scratch-assignments">
      <el-card v-for="assignment in assignments" :key="assignment.id" shadow="hover">
        <template #header>
          <div class="card-head"><strong>{{ assignment.title }}</strong><el-tag>{{ statusText(assignment.works[0]?.status) }}</el-tag></div>
        </template>
        <p>{{ assignment.statementMd || assignment.template.description || '教师暂未填写任务说明' }}</p>
        <dl>
          <div><dt>课次</dt><dd>{{ assignment.session?.title || '-' }}</dd></div>
          <div><dt>满分</dt><dd>{{ assignment.maxScore }}</dd></div>
          <div><dt>批阅方式</dt><dd>{{ judgeText(assignment.judgeMode) }}</dd></div>
          <div><dt>截止</dt><dd>{{ formatTime(assignment.dueAt) }}</dd></div>
        </dl>
        <div v-if="assignment.works[0]?.latestReview" class="latest-result">
          教师批阅：{{ assignment.works[0].latestReview?.score ?? '未评分' }} · {{ assignment.works[0].latestReview?.comment || '无文字点评' }}
        </div>
        <div class="card-actions">
          <el-button link type="primary" @click="downloadScratchTemplate(assignment.template, studentId)">下载模板</el-button>
          <el-button
            data-testid="open-student-scratch-work"
            type="primary"
            :disabled="readonly && !assignment.works.length"
            @click="openAssignment(assignment)"
          >
            {{ assignment.works.length ? '查看作品' : readonly ? '尚无作品' : '开始任务' }}
          </el-button>
        </div>
      </el-card>
    </div>

    <el-drawer v-model="workVisible" data-testid="scratch-work-learning-drawer" size="min(820px, 96vw)" title="Scratch 作品" append-to-body>
      <template v-if="work">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="任务">{{ work.assignment.title }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusText(work.status) }}</el-descriptions-item>
          <el-descriptions-item label="当前版本">v{{ work.currentVersion }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ formatTime(work.submittedAt) }}</el-descriptions-item>
        </el-descriptions>

        <section v-if="!readonly" class="save-panel">
          <h3>保存新版本</h3>
          <div class="save-form">
            <el-upload accept=".sb3" :auto-upload="false" :show-file-list="false" :limit="1" :on-change="selectProject">
              <el-button data-testid="select-scratch-work">选择 .sb3 作品</el-button>
            </el-upload>
            <span class="file-name">{{ project?.name || '未选择文件' }}</span>
            <el-input v-model="form.note" placeholder="版本说明（可选）" />
            <el-button data-testid="save-scratch-version" type="primary" :loading="saving" @click="saveVersion">保存新版本</el-button>
          </div>
          <div class="submit-form">
            <el-input v-model="form.submitNote" placeholder="提交说明（可选）" />
            <el-button data-testid="submit-scratch-work" type="success" :loading="saving" @click="submit">提交当前版本</el-button>
          </div>
        </section>

        <h3>版本历史</h3>
        <el-table :data="work.versions" data-testid="student-scratch-versions" size="small">
          <el-table-column label="版本" width="80"><template #default="{ row }">v{{ row.version }}</template></el-table-column>
          <el-table-column label="来源" width="130"><template #default="{ row }">{{ sourceText(row.source) }}</template></el-table-column>
          <el-table-column prop="note" label="说明" min-width="170" />
          <el-table-column label="时间" width="180"><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></el-table-column>
          <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="primary" @click="downloadVersionRow(row)">下载</el-button></template></el-table-column>
        </el-table>

        <h3>判定与教师点评</h3>
        <el-empty v-if="!work.judgeRuns.length && !work.reviews.length" description="尚无判定或点评" :image-size="64" />
        <el-timeline v-else data-testid="student-scratch-feedback">
          <el-timeline-item v-for="item in work.reviews" :key="`review-${item.id}`" :timestamp="formatTime(item.createdAt)" type="success">
            <strong>教师批阅：{{ item.score === null ? '未评分' : `${item.score} 分` }}</strong><div>{{ item.comment || '无文字点评' }}</div>
          </el-timeline-item>
          <el-timeline-item v-for="item in work.judgeRuns" :key="`judge-${item.id}`" :timestamp="formatTime(item.finishedAt || item.requestedAt || undefined)">
            <strong>判定：{{ item.status }}{{ item.score === null ? '' : ` · ${item.score} 分` }}</strong><div>{{ item.message || '等待结果' }}</div>
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { toRef, watch } from 'vue';
import { useScratchLearning } from '../composables/useScratchLearning';
import type { ScratchVersionView } from '../api';

const props = defineProps<{ studentId: string; readonly: boolean }>();
const studentId = toRef(props, 'studentId');
const readonly = toRef(props, 'readonly');
const {
  assignments, downloadScratchTemplate, downloadScratchVersion, form, load, loading, openAssignment, project,
  saveVersion, saving, selectProject, submit, work, workVisible,
} = useScratchLearning(studentId, readonly);

watch(studentId, () => void load(), { immediate: true });

const statusText = (status?: string) => ({ draft: '草稿', submitted: '已提交', reviewed: '已批阅' }[status || ''] || '未开始');
const judgeText = (mode: string) => ({ manual: '教师人工批阅', external: '外部自动判定', none: '仅收集作品' }[mode] || mode);
const sourceText = (source: string) => ({ template_copy: '模板副本', student_save: '学生保存', submission: '提交固化', import: '历史迁移' }[source] || source);
const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const downloadVersionRow = (row: unknown) => downloadScratchVersion(row as ScratchVersionView);
</script>

<style scoped>
.scratch-learning { min-height: 360px; }
.scratch-toolbar, .card-head, .card-actions, .save-form, .submit-form { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.scratch-toolbar { margin: 12px 0; }
.assignment-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 14px; overflow: auto; max-height: 100%; }
.assignment-grid p { min-height: 44px; white-space: pre-wrap; }
.assignment-grid dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
.assignment-grid dl div { display: flex; gap: 8px; }
.assignment-grid dt { color: var(--el-text-color-secondary); }
.assignment-grid dd { margin: 0; }
.latest-result { margin: 10px 0; padding: 8px; border-radius: 6px; background: var(--el-fill-color-light); }
.save-panel { margin-top: 18px; padding: 14px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.save-panel h3 { margin-top: 0; }
.save-form { display: grid; grid-template-columns: auto minmax(100px, 180px) 1fr auto; }
.submit-form { margin-top: 10px; justify-content: flex-end; }
.submit-form .el-input { max-width: 420px; }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-secondary); }
@media (max-width: 760px) { .save-form { grid-template-columns: 1fr; } .submit-form { align-items: stretch; flex-direction: column; } }
</style>
