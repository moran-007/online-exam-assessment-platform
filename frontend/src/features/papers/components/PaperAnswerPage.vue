<template>
  <div class="page exam-page">
    <div class="page-head exam-head">
      <div>
        <h1 class="page-title">{{ paper?.name || '试卷试答' }}</h1>
        <span class="muted">{{ practiceSubtitle }}</span>
      </div>
      <div class="toolbar">
        <el-tag v-if="submitted" :type="resultSummaryType">{{ resultSummaryText }}</el-tag>
        <el-tag type="info">不落库</el-tag>
        <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
          <el-radio-button label="side">左右</el-radio-button>
          <el-radio-button label="stack">上下</el-radio-button>
        </el-radio-group>
        <el-button
          v-if="isStudent && submitted && manualWrongEntries.length"
          type="success"
          :icon="Notebook"
          :loading="addingWrongQuestions"
          @click="addWrongQuestionsToBook"
        >
          错题加入错题本
        </el-button>
        <el-button :icon="Back" @click="router.push(returnPath)">{{ returnButtonText }}</el-button>
        <el-button :icon="Delete" @click="clearAll">清空</el-button>
        <el-button type="primary" :icon="Check" @click="submit">检查答案</el-button>
      </div>
    </div>

    <div class="exam-layout">
      <main
        class="exam-main"
        :class="{ 'is-programming-main': visibleEntries[0]?.snapshot.type === 'programming' }"
      >
        <template v-if="visibleEntries.length">
          <section
            v-for="entry in visibleEntries"
            :key="entry.question.questionId"
            :data-question-id="entry.question.questionId"
            class="question-card exam-question answer-layout-question"
          >
            <div class="question-title">
              <div>
                <span>第 {{ entry.index + 1 }} 题</span>
                <span class="muted">{{ entry.sectionTitle }}</span>
              </div>
              <div class="toolbar">
                <el-tag :type="isAnswered(entry.question.questionId) ? 'success' : 'info'">
                  {{ isAnswered(entry.question.questionId) ? '已答' : '未答' }}
                </el-tag>
                <el-tag>{{ entry.question.score }} 分</el-tag>
                <el-tag v-if="submitted" :type="resultTagType(entry.result)">
                  {{ resultLabel(entry.result) }}
                </el-tag>
              </div>
            </div>

            <QuestionAnswerLayout
              :mode="answerLayout"
              :class="{ 'is-programming-workspace': entry.snapshot.type === 'programming' }"
            >
              <template #statement>
                <div v-if="entry.materialContext" class="material-context">
                  <h3>{{ entry.materialContext.title }}</h3>
                  <MarkdownRenderer :source="entry.materialContext.content" />
                </div>
                <h2 class="exam-question-title">{{ entry.snapshot.title || `第 ${entry.index + 1} 题` }}</h2>
                <MarkdownRenderer :source="entry.snapshot.content" />
                <div v-if="submitted" class="paper-analysis">
                  <strong>解析</strong>
                  <MarkdownRenderer :source="entry.snapshot.analysis || '暂无解析'" />
                </div>
              </template>

              <template #answer>
                <div class="question-answer-body">
                  <div v-if="entry.snapshot.type === 'programming'" class="programming-answer">
                    <div class="programming-command-row">
                      <ProgrammingToolbarShell :summary="languageLabel(answers[entry.question.questionId].language)">
                        <template #badge>
                          <el-tag v-if="!matchedHydroAccountsFor(entry.snapshot).length" type="warning" size="small">无账号</el-tag>
                        </template>
                        <template #default="{ close }">
                          <div class="programming-toolbar">
                            <span class="programming-language-label">语言</span>
                            <el-select v-model="answers[entry.question.questionId].language" style="width: 170px" @change="close">
                              <el-option
                                v-for="language in languageOptionsFor(entry.snapshot)"
                                :key="language"
                                :label="languageLabel(language)"
                                :value="language"
                              />
                            </el-select>
                            <el-tag v-if="entry.snapshot.programmingRef?.externalProblemId" type="success">
                              {{ entry.snapshot.programmingRef.externalProblemId }}
                            </el-tag>
                            <span class="programming-language-label">账号</span>
                            <el-select
                              v-model="selectedHydroAccountIds[entry.question.questionId]"
                              :disabled="!matchedHydroAccountsFor(entry.snapshot).length"
                              placeholder="选择提交账号"
                              style="width: 230px"
                              @change="close"
                            >
                              <el-option
                                v-for="account in matchedHydroAccountsFor(entry.snapshot)"
                                :key="account.id"
                                :label="hydroAccountLabel(account)"
                                :value="account.id"
                              />
                            </el-select>
                            <el-button
                              v-if="entry.snapshot.programmingRef?.externalProblemUrl"
                              :icon="Link"
                              @click="close(); openHydroProblem(entry.snapshot)"
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
                          :disabled="!selectedHydroAccountIds[entry.question.questionId] || submitted"
                          @click="submitPracticeCode(entry)"
                        >
                          提交 Hydro 评测
                        </el-button>
                        <span v-if="!selectedHydroAccountIds[entry.question.questionId]" class="muted">
                          请先在提交设置中选择同站点账号
                        </span>
                      </div>
                    </div>
                    <el-alert
                      v-if="codeSubmitFeedback[entry.question.questionId]"
                      class="code-submit-feedback"
                      :type="codeSubmitFeedback[entry.question.questionId].type"
                      :closable="false"
                      show-icon
                    >
                      <template #title>{{ codeSubmitFeedback[entry.question.questionId].title }}</template>
                      <div class="code-submit-meta">
                        <span>状态：{{ codeSubmitFeedback[entry.question.questionId].status }}</span>
                        <span v-if="codeSubmitFeedback[entry.question.questionId].score !== null">
                          得分：{{ codeSubmitFeedback[entry.question.questionId].score }} /
                          {{ codeSubmitFeedback[entry.question.questionId].maxScore }}
                        </span>
                        <span v-if="codeSubmitFeedback[entry.question.questionId].totalTestCaseCount">
                          测试点：{{ codeSubmitFeedback[entry.question.questionId].passedTestCaseCount }} /
                          {{ codeSubmitFeedback[entry.question.questionId].totalTestCaseCount }}
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
                    :question="entry.snapshot"
                    :type="entry.snapshot.type"
                    :rows="isSplitQuestion(entry.snapshot.type) ? 22 : 6"
                    :show-correct="submitted"
                  />
                </div>
              </template>
            </QuestionAnswerLayout>
          </section>
        </template>

        <el-empty v-else description="暂无题目" />
      </main>

      <aside class="exam-aside panel">
        <div class="exam-progress">
          <div class="exam-progress-head">
            <strong>练习进度</strong>
            <span>{{ answeredCount }} / {{ totalCount }}</span>
          </div>
          <el-progress :percentage="progressPercent" :show-text="false" />
        </div>
        <div class="question-number-grid">
          <button
            v-for="entry in flatQuestions"
            :key="entry.question.questionId"
            type="button"
            :class="{
              'question-nav-item': true,
              current: entry.index === currentIndex,
              answered: isAnswered(entry.question.questionId),
              unanswered: !isAnswered(entry.question.questionId),
              flagged: submitted && entry.result?.isCorrect === false,
            }"
            :title="numberTitle(entry)"
            @click="goQuestion(entry.index)"
          >
            <span>{{ entry.index + 1 }}</span>
          </button>
        </div>
        <div v-if="totalCount" class="aside-stepbar">
          <el-button :icon="Delete" :disabled="!visibleEntries[0]" @click="clearAnswer(visibleEntries[0].question.questionId)">清除</el-button>
          <el-button :icon="ArrowLeft" :disabled="currentIndex <= 0" @click="goQuestion(currentIndex - 1)">上一题</el-button>
          <el-button type="primary" :icon="ArrowRight" :disabled="currentIndex >= totalCount - 1" @click="goQuestion(currentIndex + 1)">
            下一题
          </el-button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ArrowLeft, ArrowRight, Back, Check, Delete, Link, Notebook, Upload } from '@element-plus/icons-vue';
import CodeAnswerEditor from '../../../components/CodeAnswerEditor.vue';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../../../components/ProgrammingToolbarShell.vue';
import QuestionAnswerHost from '../../../components/QuestionAnswerHost.vue';
import QuestionAnswerLayout from '../../../components/QuestionAnswerLayout.vue';
import { usePaperAnswerPage } from '../composables/usePaperAnswerPage';

const {
  router, paper, answers, codeSubmitLoading, codeSubmitFeedback, selectedHydroAccountIds,
  submitted, addingWrongQuestions, currentIndex, answerLayout, isStudent, returnPath,
  returnButtonText, practiceSubtitle, flatQuestions, totalCount, visibleEntries, answeredCount,
  progressPercent, resultSummaryType, resultSummaryText, manualWrongEntries, clearAll,
  clearAnswer, submit, addWrongQuestionsToBook, isAnswered, resultTagType, resultLabel,
  numberTitle, goQuestion, submitPracticeCode, matchedHydroAccountsFor, openHydroProblem,
  isSplitQuestion, languageOptionsFor, languageLabel, hydroAccountLabel,
} = usePaperAnswerPage();
</script>
