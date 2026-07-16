<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">错题本</h1>
      <div class="toolbar">
        <el-button type="primary" :icon="Aim" :disabled="!canUseActiveActions" @click="pickRandom">随机抽题</el-button>
        <el-button type="success" :icon="Document" :disabled="!canUseActiveActions" @click="generateWrongPaper">错题组卷</el-button>
        <el-button :icon="Download" :disabled="!canUseActiveActions" @click="exportVisible = true">导出错题</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </div>
    <el-tabs v-model="wrongTab" class="page-tabs" @tab-change="load">
      <el-tab-pane label="未掌握" name="active" />
      <el-tab-pane label="已掌握" name="mastered" />
    </el-tabs>

    <div class="panel wrong-add-panel">
      <div class="toolbar">
        <el-input
          v-model="candidateKeyword"
          clearable
          placeholder="搜索公开题目后加入错题本"
          style="width: 240px"
          @keyup.enter="loadCandidates"
          @clear="loadCandidates"
        />
        <el-button :icon="Search" @click="loadCandidates">搜索</el-button>
        <el-select
          v-model="selectedCandidateId"
          filterable
          placeholder="选择题目"
          style="width: 360px"
        >
          <el-option
            v-for="question in candidates"
            :key="question.id"
            :label="question.title"
            :value="question.id"
          />
        </el-select>
        <el-button type="success" :icon="Plus" :disabled="!selectedCandidateId" @click="addWrongQuestion">
          加入错题本
        </el-button>
      </div>
    </div>

    <div class="wrong-insight-grid">
      <div class="panel wrong-insight-card">
        <div class="section-head compact">
          <h2>来源追踪</h2>
          <span class="muted">考试 / 练习 / 手动</span>
        </div>
        <div class="source-stack">
          <div v-for="item in insights.sourceSummary" :key="item.sourceType" class="source-item">
            <span>{{ sourceLabel(item.sourceType) }}</span>
            <strong>{{ item.count }}</strong>
          </div>
          <el-empty v-if="!insights.sourceSummary.length" description="暂无来源记录" :image-size="48" />
        </div>
      </div>
      <div class="panel wrong-insight-card">
        <div class="section-head compact">
          <h2>掌握曲线</h2>
          <span class="muted">最近记录</span>
        </div>
        <div class="curve-list">
          <div v-for="item in insights.masteryCurve.slice(-7)" :key="item.date" class="curve-row">
            <span class="curve-date">{{ item.date.slice(5) }}</span>
            <div class="curve-bars">
              <span class="curve-bar wrong" :style="{ width: barWidth(item.wrong) }" />
              <span class="curve-bar mastered" :style="{ width: barWidth(item.mastered) }" />
              <span class="curve-bar manual" :style="{ width: barWidth(item.manual) }" />
            </div>
            <span class="muted">{{ item.wrong }}/{{ item.mastered }}/{{ item.manual }}</span>
          </div>
          <el-empty v-if="!insights.masteryCurve.length" description="暂无练习曲线" :image-size="48" />
        </div>
      </div>
      <div class="panel wrong-insight-card wrong-reminder-card">
        <div class="section-head compact">
          <h2>复习提醒</h2>
          <span class="muted">优先处理到期题</span>
        </div>
        <div class="reminder-list">
          <button
            v-for="item in insights.reviewReminders.slice(0, 5)"
            :key="item.questionId"
            class="plain-row-button reminder-item"
            type="button"
            @click="openReminder(item.questionId)"
          >
            <span class="ellipsis">{{ item.title }}</span>
            <el-tag size="small" :type="item.overdue ? 'danger' : 'info'">
              {{ item.overdue ? '待复习' : formatShortDate(item.nextReviewAt) }}
            </el-tag>
          </button>
          <el-empty v-if="!insights.reviewReminders.length" description="暂无复习提醒" :image-size="48" />
        </div>
      </div>
    </div>

    <div class="panel question-table-panel wrong-table-panel">
      <el-table :data="items" height="100%" highlight-current-row @row-click="openPractice">
        <el-table-column label="题目" min-width="280">
          <template #default="{ row }">
            <div class="wrongbook-title">
              <strong>{{ row.question.title }}</strong>
              <el-tag v-if="row.question.status !== 'published'" size="small" type="warning">非公开</el-tag>
            </div>
            <div class="muted">{{ row.question.courseName }} · {{ typeLabel(row.question.type) }}</div>
            <div class="tag-line">
              <el-tag v-for="tag in row.question.tags || []" :key="tag.id" size="small" effect="plain">
                {{ tag.name }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" label="来源" width="100">
          <template #default="{ row }">{{ sourceLabel(row.sourceType) }}</template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" prop="wrongCount" label="错误次数" width="100" />
        <el-table-column v-if="showMediumColumns" label="掌握状态" width="120">
          <template #default="{ row }">{{ masteryLabel(row.masteryStatus) }}</template>
        </el-table-column>
        <el-table-column v-if="showLowColumns" prop="lastWrongAt" label="最近记录" width="180" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <div class="row-action-cell" @click.stop @mousedown.stop>
              <el-dropdown trigger="click" @command="(command) => handleWrongCommand(row, command)">
                <el-button size="small" @click.stop>操作</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="practice">作答</el-dropdown-item>
                    <el-dropdown-item command="events">来源记录</el-dropdown-item>
                    <el-dropdown-item v-if="row.masteryStatus !== 'mastered'" command="master">标记掌握</el-dropdown-item>
                    <el-dropdown-item v-else command="review">继续复习</el-dropdown-item>
                    <el-dropdown-item command="hide">移出</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="practiceVisible" title="错题练习" :width="practiceDialogWidth">
      <template v-if="practice">
        <div class="paper-preview-head answer-dialog-head">
          <div>
            <h2>{{ practice.question.title }}</h2>
            <span class="muted">{{ typeLabel(practice.question.type) }} · {{ practice.question.defaultScore }} 分</span>
          </div>
          <div class="toolbar">
            <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
              <el-radio-button label="side">左右</el-radio-button>
              <el-radio-button label="stack">上下</el-radio-button>
            </el-radio-group>
            <el-tag type="warning">个人错题</el-tag>
          </div>
        </div>

        <QuestionAnswerLayout :mode="answerLayout" framed>
          <template #statement>
            <MarkdownRenderer :source="practice.question.content" />
          </template>

          <template #answer>
            <div class="question-answer-body">
              <div v-if="practice.question.type === 'programming'" class="programming-answer">
                <ProgrammingToolbarShell :summary="languageLabel(answer.language)">
                  <template #default="{ close }">
                  <div class="programming-toolbar">
                    <span class="programming-language-label">语言</span>
                    <el-select v-model="answer.language" style="width: 170px" @change="close">
                      <el-option
                        v-for="language in languageOptionsFor(practice.question)"
                        :key="language"
                        :label="languageLabel(language)"
                        :value="language"
                      />
                    </el-select>
                    <el-tag v-if="practice.question.programmingRef?.externalProblemId" type="success">
                      {{ practice.question.programmingRef.externalProblemId }}
                    </el-tag>
                    <el-button
                      :icon="Link"
                      :disabled="!practice.question.programmingRef?.externalProblemUrl"
                      @click="close(); openHydroProblem(practice.question)"
                    >
                      打开 Hydro
                    </el-button>
                  </div>
                  </template>
                </ProgrammingToolbarShell>
                <CodeAnswerEditor
                  v-model="answer.code"
                  :language="answer.language"
                  :language-label="languageLabel(answer.language)"
                  :rows="18"
                />
              </div>
              <QuestionAnswerHost
                v-else
                :model-value="answer"
                :question="practice.question"
                :type="practice.question.type"
                :rows="isObjectiveQuestionType(practice.question.type) ? 5 : 18"
                @update:model-value="mergeAnswer"
              />
            </div>
          </template>
        </QuestionAnswerLayout>

        <div class="toolbar question-actions">
          <el-button type="primary" :icon="Check" @click="checkPractice">提交练习</el-button>
          <el-button :icon="Delete" @click="clearPracticeAnswer">清空答案</el-button>
          <el-button v-if="practice.masteryStatus !== 'mastered'" :icon="Check" @click="markCurrentMastered">标记掌握</el-button>
          <el-button :icon="Hide" @click="hideCurrent">移出错题本</el-button>
        </div>

        <el-alert
          v-if="practiceResult"
          :title="`${practiceResult.message}，得分 ${practiceResult.score} / ${practiceResult.totalScore}`"
          :type="practiceResult.isCorrect ? 'success' : practiceResult.isCorrect === false ? 'error' : 'warning'"
          show-icon
          :closable="false"
          class="batch-alert"
        />
        <AnswerFeedback :result="practiceResult" />
      </template>
      <template #footer>
        <el-button @click="practiceVisible = false">关闭</el-button>
        <el-button type="primary" @click="checkPractice">提交练习</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="exportVisible" title="导出错题" width="420px">
      <el-form :model="exportForm" label-width="86px">
        <el-form-item label="格式">
          <el-radio-group v-model="exportForm.format">
            <el-radio-button label="pdf">PDF</el-radio-button>
            <el-radio-button label="docx">Word</el-radio-button>
            <el-radio-button label="csv">CSV</el-radio-button>
            <el-radio-button label="xlsx">Excel</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="内容">
          <el-checkbox v-model="exportForm.includeAnswers">带答案</el-checkbox>
          <el-checkbox v-model="exportForm.includeAnalysis">带解析</el-checkbox>
          <el-checkbox v-model="exportForm.includeWrongInfo">带错题次数</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="exportVisible = false">取消</el-button>
        <el-button type="primary" :icon="Download" @click="exportWrongQuestions">生成并下载</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="traceVisible" title="错题来源记录" size="420px">
      <h3 class="drawer-title">{{ traceTitle }}</h3>
      <el-timeline>
        <el-timeline-item
          v-for="event in traceEvents"
          :key="event.id"
          :timestamp="formatDateTime(event.happenedAt)"
          :type="event.isCorrect ? 'success' : event.isCorrect === false ? 'danger' : 'info'"
        >
          <div class="trace-event-title">{{ eventLabel(event.eventType) }}</div>
          <div class="muted">
            {{ sourceLabel(event.sourceType) }}
            <span v-if="event.score !== null"> · {{ event.score }} 分</span>
            <span v-if="event.masteryStatus"> · {{ masteryLabel(event.masteryStatus) }}</span>
          </div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-if="!traceEvents.length" description="暂无来源记录" />
    </el-drawer>
  </div>
</template>

<script setup>
import { Aim, Check, Delete, Document, Download, Hide, Link, Plus, Refresh, Search } from '@element-plus/icons-vue';
import AnswerFeedback from '../../../components/AnswerFeedback.vue';
import CodeAnswerEditor from '../../../components/CodeAnswerEditor.vue';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../../../components/ProgrammingToolbarShell.vue';
import QuestionAnswerHost from '../../../components/QuestionAnswerHost.vue';
import QuestionAnswerLayout from '../../../components/QuestionAnswerLayout.vue';
import { useWrongQuestionPage } from '../composables/useWrongQuestionPage';

const {
  addWrongQuestion,
  answer,
  answerLayout,
  barWidth,
  canUseActiveActions,
  candidateKeyword,
  candidates,
  checkPractice,
  clearPracticeAnswer,
  eventLabel,
  exportForm,
  exportVisible,
  exportWrongQuestions,
  formatDateTime,
  formatShortDate,
  generateWrongPaper,
  handleWrongCommand,
  hideCurrent,
  insights,
  isObjectiveQuestionType,
  items,
  languageLabel,
  languageOptionsFor,
  load,
  loadCandidates,
  markCurrentMastered,
  masteryLabel,
  mergeAnswer,
  openHydroProblem,
  openPractice,
  openReminder,
  pickRandom,
  practice,
  practiceDialogWidth,
  practiceResult,
  practiceVisible,
  selectedCandidateId,
  showLowColumns,
  showMediumColumns,
  sourceLabel,
  traceEvents,
  traceTitle,
  traceVisible,
  typeLabel,
  wrongTab,
} = useWrongQuestionPage();
</script>

<style scoped>
.wrong-insight-grid {
  display: grid;
  grid-template-columns: minmax(220px, 0.9fr) minmax(260px, 1.1fr) minmax(280px, 1.2fr);
  gap: 12px;
  min-height: 0;
}

.wrong-insight-card {
  min-height: 148px;
  padding: 14px 16px;
  overflow: hidden;
}

.section-head.compact {
  margin-bottom: 10px;
}

.section-head.compact h2 {
  font-size: 16px;
}

.source-stack,
.curve-list,
.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.source-item,
.reminder-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px 10px;
  background: #fff;
}

.source-item strong {
  color: var(--el-color-primary);
}

.curve-row {
  display: grid;
  grid-template-columns: 48px minmax(80px, 1fr) 64px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.curve-date {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.curve-bars {
  display: flex;
  gap: 3px;
  align-items: center;
  min-width: 0;
}

.curve-bar {
  display: inline-block;
  height: 8px;
  min-width: 8px;
  border-radius: 999px;
}

.curve-bar.wrong {
  background: var(--el-color-danger-light-3);
}

.curve-bar.mastered {
  background: var(--el-color-success-light-3);
}

.curve-bar.manual {
  background: var(--el-color-warning-light-3);
}

.plain-row-button {
  border: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.plain-row-button:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}

.drawer-title {
  margin: 0 0 16px;
  font-size: 16px;
}

.trace-event-title {
  font-weight: 600;
}

@media (max-width: 1180px) {
  .wrong-insight-grid {
    grid-template-columns: 1fr;
  }

  .wrong-insight-card {
    min-height: auto;
  }
}
</style>

