<template>
  <div class="page exam-page">
    <div class="page-head exam-head">
      <div>
        <h1 class="page-title">{{ exam?.name || '考试' }}</h1>
        <span class="muted">共 {{ totalCount }} 题，已答 {{ answeredCount }} 题，标疑 {{ flaggedCount }} 题</span>
      </div>
      <div class="toolbar">
        <el-tag v-if="isSimulating" type="warning">教师模拟学生</el-tag>
        <el-button v-if="isSimulating" :icon="Close" @click="exitSimulation">退出模拟</el-button>
        <ExamCountdownTag :remaining-ms="remainingMs" />
        <el-tag>{{ answeredCount }} / {{ totalCount }}</el-tag>
        <el-tooltip :content="asideCollapsed ? '展开答题卡' : '收起答题卡'" placement="bottom">
          <el-button :icon="asideCollapsed ? Expand : Fold" @click="toggleAside" />
        </el-tooltip>
        <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
          <el-radio-button label="side">左右</el-radio-button>
          <el-radio-button label="stack">上下</el-radio-button>
        </el-radio-group>
        <el-button :icon="Upload" :disabled="autoSubmitting" @click="saveAll()">保存</el-button>
        <el-button type="primary" :icon="Check" :loading="autoSubmitting" @click="submit()">提交</el-button>
      </div>
    </div>

    <div class="exam-layout" :class="{ 'is-aside-collapsed': asideCollapsed }">
      <main
        class="exam-main"
        :class="{ 'is-programming-main': visibleEntries[0]?.question.type === 'programming' }"
      >
        <template v-if="visibleEntries.length && visibleEntriesReady">
          <section
            v-for="entry in visibleEntries"
            :id="`question-${entry.question.questionId}`"
            :key="entry.question.questionId"
            class="question-card exam-question answer-layout-question"
          >
            <div class="question-title">
              <div>
                <span>第 {{ entry.index + 1 }} 题</span>
                <span class="muted">{{ questionMetaLabel(entry) }}</span>
              </div>
              <div class="toolbar">
                <el-tag :type="isAnswered(entry.question.questionId) ? 'success' : 'info'">
                  {{ isAnswered(entry.question.questionId) ? '已答' : '未答' }}
                </el-tag>
                <el-tag v-if="isFlagged(entry.question.questionId)" type="warning">有疑问</el-tag>
                <el-tag>{{ entry.question.score }} 分</el-tag>
              </div>
            </div>

            <QuestionAnswerLayout
              :mode="answerLayout"
              :class="{ 'is-programming-workspace': entry.question.type === 'programming' }"
            >
              <template #statement>
                <div v-if="entry.materialContext" class="material-context">
                  <h3>{{ entry.materialContext.title }}</h3>
                  <MarkdownRenderer :source="entry.materialContext.content" />
                </div>
                <h2 class="exam-question-title">{{ entry.question.title || `第 ${entry.index + 1} 题` }}</h2>
                <MarkdownRenderer :source="entry.question.content" />
              </template>

              <template #answer>
                <div class="question-answer-body">
                  <div v-if="entry.question.type === 'programming'" class="programming-answer">
                    <div class="programming-command-row">
                      <ProgrammingToolbarShell :summary="languageLabel(answers[entry.question.questionId].language)">
                      <template #badge>
                        <el-tag v-if="!matchedHydroAccountsFor(entry.question).length" type="warning" size="small">无账号</el-tag>
                      </template>
                      <template #default="{ close }">
                      <div class="programming-toolbar">
                        <span class="programming-language-label">语言</span>
                        <el-select v-model="answers[entry.question.questionId].language" style="width: 170px" @change="close">
                          <el-option
                            v-for="language in languageOptionsFor(entry.question)"
                            :key="language"
                            :label="languageLabel(language)"
                            :value="language"
                          />
                        </el-select>
                        <el-tag v-if="entry.question.programmingRef?.platformBaseUrl || entry.question.programmingRef?.externalProblemUrl" type="info">
                          来源：{{ hydroSourceLabel(entry.question.programmingRef) }}
                        </el-tag>
                        <el-tag v-if="entry.question.programmingRef?.domainId" type="info">
                          域：{{ entry.question.programmingRef.domainName || entry.question.programmingRef.domainId }}
                        </el-tag>
                        <el-tag v-if="entry.question.programmingRef?.externalProblemId" type="success">
                          {{ entry.question.programmingRef.externalProblemId }}
                        </el-tag>
                        <span class="programming-language-label">账号</span>
                        <el-select
                          v-model="selectedHydroAccountIds[entry.question.questionId]"
                          :disabled="!matchedHydroAccountsFor(entry.question).length"
                          placeholder="选择提交账号"
                          style="width: 230px"
                          @change="close"
                        >
                          <el-option
                            v-for="account in matchedHydroAccountsFor(entry.question)"
                            :key="account.id"
                            :label="hydroAccountLabel(account)"
                            :value="account.id"
                          />
                        </el-select>
                        <el-tag v-if="!matchedHydroAccountsFor(entry.question).length" type="warning">无同站点账号</el-tag>
                        <el-button
                          v-if="entry.question.programmingRef?.externalProblemUrl"
                          :icon="Link"
                          @click="close(); openHydroProblem(entry.question)"
                        >
                          打开 Hydro
                        </el-button>
                      </div>
                      </template>
                      </ProgrammingToolbarShell>
                      <div class="programming-primary-actions">
                        <el-button
                          type="primary"
                          :icon="Upload"
                          :loading="Boolean(codeSubmitLoading[entry.question.questionId])"
                          :disabled="!selectedHydroAccountIds[entry.question.questionId]"
                          @click="submitCode(entry)"
                        >
                          提交 Hydro 评测
                        </el-button>
                        <el-button
                          v-if="codeSubmitFeedback[entry.question.questionId]?.submissionId"
                          :icon="Refresh"
                          :loading="Boolean(codeSubmitLoading[entry.question.questionId])"
                          @click="refreshSubmission(entry.question.questionId)"
                        >
                          刷新结果
                        </el-button>
                        <span v-if="!selectedHydroAccountIds[entry.question.questionId]" class="muted">请先在提交设置中选择同站点账号</span>
                      </div>
                    </div>
                    <el-alert
                      v-if="codeSubmitFeedback[entry.question.questionId]"
                      class="code-submit-feedback"
                      :type="codeSubmitFeedback[entry.question.questionId].type"
                      :closable="false"
                      show-icon
                    >
                      <template #title>
                        {{ codeSubmitFeedback[entry.question.questionId].title }}
                      </template>
                      <div class="code-submit-meta">
                        <span v-if="codeSubmitFeedback[entry.question.questionId].status">
                          状态：{{ codeSubmitFeedback[entry.question.questionId].status }}
                        </span>
                        <span v-if="codeSubmitFeedback[entry.question.questionId].language">
                          语言：{{ languageLabel(codeSubmitFeedback[entry.question.questionId].language) }}
                        </span>
                        <span v-if="codeSubmitFeedback[entry.question.questionId].externalSubmissionId">
                          Hydro提交：{{ codeSubmitFeedback[entry.question.questionId].externalSubmissionId }}
                        </span>
                        <span v-if="codeSubmitFeedback[entry.question.questionId].score !== null && codeSubmitFeedback[entry.question.questionId].score !== undefined">
                          得分：{{ codeSubmitFeedback[entry.question.questionId].score }} / {{ codeSubmitFeedback[entry.question.questionId].maxScore }}
                        </span>
                        <span v-if="codeSubmitFeedback[entry.question.questionId].totalTestCaseCount">
                          测试点：{{ codeSubmitFeedback[entry.question.questionId].passedTestCaseCount }} / {{ codeSubmitFeedback[entry.question.questionId].totalTestCaseCount }}
                        </span>
                        <el-link
                          v-if="codeSubmitFeedback[entry.question.questionId].recordUrl"
                          type="primary"
                          :href="codeSubmitFeedback[entry.question.questionId].recordUrl"
                          target="_blank"
                        >
                          查看 Hydro 记录
                        </el-link>
                      </div>
                      <div v-if="codeSubmitFeedback[entry.question.questionId].message" class="code-submit-message">
                        {{ codeSubmitFeedback[entry.question.questionId].message }}
                      </div>
                    </el-alert>
                    <CodeAnswerEditor
                      v-model="answers[entry.question.questionId].code"
                      :language="answers[entry.question.questionId].language"
                      :language-label="languageLabel(answers[entry.question.questionId].language)"
                      :rows="22"
                    />
                  </div>
                  <QuestionAnswerHost
                    v-else
                    v-model="answers[entry.question.questionId]"
                    :question="entry.question"
                    :type="entry.question.type"
                    :rows="isSplitQuestion(entry.question.type) ? 22 : 6"
                  />
                </div>
              </template>
            </QuestionAnswerLayout>
</section>
        </template>

        <el-empty v-else-if="!visibleEntries.length" description="暂无题目" />
</main>

      <aside class="exam-aside panel" :class="{ 'is-collapsed': asideCollapsed }">
        <div class="exam-aside-toggle">
          <el-tooltip :content="asideCollapsed ? '展开答题卡' : '收起答题卡'" placement="left">
            <el-button :icon="asideCollapsed ? Expand : Fold" @click="toggleAside" />
          </el-tooltip>
        </div>
        <template v-if="!asideCollapsed">
          <div class="exam-progress">
            <div class="exam-progress-head">
              <strong>答题卡</strong>
              <span>{{ progressPercent }}%</span>
            </div>
            <el-progress :percentage="progressPercent" :show-text="false" />
          </div>

          <div class="question-number-grid">
            <button
              v-for="entry in flatQuestions"
              :key="entry.question.questionId"
              type="button"
              :class="numberButtonClass(entry)"
              :title="numberTitle(entry)"
              @click="goQuestion(entry.index)"
            >
              <span>{{ entry.index + 1 }}</span>
              <i v-if="isFlagged(entry.question.questionId)">?</i>
            </button>
          </div>

          <div class="status-legend">
            <span><b class="legend-dot answered"></b>已答</span>
            <span><b class="legend-dot unanswered"></b>未答</span>
            <span><b class="legend-dot flagged"></b>标疑</span>
          </div>

          <el-divider />

          <div class="aside-actions">
            <el-button :icon="Flag" :type="currentQuestionId && isFlagged(currentQuestionId) ? 'warning' : 'default'" @click="toggleCurrentFlag">
              {{ currentQuestionId && isFlagged(currentQuestionId) ? '取消本题标疑' : '本题标疑' }}
            </el-button>
            <el-button :icon="Upload" :disabled="autoSubmitting" @click="saveAll()">保存全部</el-button>
            <el-button type="primary" :icon="Check" :loading="autoSubmitting" @click="submit()">提交试卷</el-button>
          </div>
          <div v-if="totalCount" class="aside-stepbar">
            <el-button :icon="Delete" :disabled="!currentQuestionId" @click="clearCurrentAnswer">清除</el-button>
            <el-button :icon="ArrowLeft" :disabled="currentIndex <= 0" @click="goQuestion(currentIndex - 1)">上一题</el-button>
            <el-button type="primary" :icon="ArrowRight" :disabled="currentIndex >= totalCount - 1" @click="goQuestion(currentIndex + 1)">
              下一题
            </el-button>
          </div>
        </template>
        <div v-else class="exam-aside-compact">
          <strong>{{ progressPercent }}%</strong>
          <span>{{ answeredCount }}/{{ totalCount }}</span>
        </div>
      </aside>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useExamTakingPage } from '../composables/useExamTakingPage';
import CodeAnswerEditor from '../../../components/CodeAnswerEditor.vue';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../../../components/ProgrammingToolbarShell.vue';
import QuestionAnswerLayout from '../../../components/QuestionAnswerLayout.vue';
import QuestionAnswerHost from '../../../components/QuestionAnswerHost.vue';
import ExamCountdownTag from './ExamCountdownTag.vue';

export default defineComponent({
  name: 'ExamTakingPage',
  components: { CodeAnswerEditor, MarkdownRenderer, ProgrammingToolbarShell, QuestionAnswerLayout, QuestionAnswerHost, ExamCountdownTag },
  setup() {
    const context = useExamTakingPage();
    return context;
  },
});
</script>
