<template>
<el-dialog v-model="practiceVisible" title="题目作答" :width="practiceDialogWidth">
      <template v-if="practiceDetail">
        <div class="paper-preview-head answer-dialog-head">
          <div>
            <h2>{{ practiceDetail.title }}</h2>
            <span class="muted">{{ typeLabel(practiceDetail.type) }} · {{ practiceDetail.defaultScore }} 分</span>
          </div>
          <div class="toolbar">
            <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
              <el-radio-button label="side">左右</el-radio-button>
              <el-radio-button label="stack">上下</el-radio-button>
            </el-radio-group>
            <el-tag :type="practiceDetail.status === 'published' ? 'success' : 'warning'">
              {{ statusLabel(practiceDetail.status) || practiceDetail.status }}
            </el-tag>
          </div>
        </div>

        <QuestionAnswerLayout :mode="answerLayout" framed>
          <template #statement>
            <MarkdownRenderer :source="practiceDetail.content || ''" />
          </template>

          <template #answer>
            <div class="question-answer-body">
              <div v-if="practiceDetail.type === 'programming'" class="programming-answer">
                <ProgrammingToolbarShell :summary="languageLabel(practiceAnswer.language)">
                  <template #badge>
                    <el-tag v-if="!practiceMatchedHydroAccounts.length" type="warning" size="small">无账号</el-tag>
                  </template>
                  <template #default="{ close }">
                  <div class="programming-toolbar">
                    <span class="programming-language-label">语言</span>
                    <el-select v-model="practiceAnswer.language" style="width: 170px" @change="close">
                      <el-option
                        v-for="language in languageOptionsFor(practiceDetail)"
                        :key="language"
                        :label="languageLabel(language)"
                        :value="language"
                      />
                    </el-select>
                    <el-tag v-if="practiceDetail.programmingRef?.platformBaseUrl || practiceDetail.programmingRef?.externalProblemUrl" type="info">
                      来源：{{ hydroSourceLabel(practiceDetail.programmingRef) }}
                    </el-tag>
                    <el-tag v-if="practiceDetail.programmingRef?.domainId" type="info">
                      域：{{ formatHydroDomainLabel(practiceDetail.programmingRef) }}
                    </el-tag>
                    <el-tag v-if="practiceDetail.programmingRef?.externalProblemId" type="success">
                      {{ practiceDetail.programmingRef.externalProblemId }}
                    </el-tag>
                    <span class="programming-language-label">账号</span>
                    <el-select
                      v-model="practiceHydroAccountId"
                      :disabled="!practiceMatchedHydroAccounts.length"
                      placeholder="选择提交账号"
                      style="width: 230px"
                      @change="close"
                    >
                      <el-option
                        v-for="account in practiceMatchedHydroAccounts"
                        :key="account.id"
                        :label="hydroPracticeAccountLabel(account)"
                        :value="account.id"
                      />
                    </el-select>
                    <el-tag v-if="!practiceMatchedHydroAccounts.length" type="warning">无同站点账号</el-tag>
                    <el-button :icon="Link" :disabled="!practiceDetail.programmingRef?.externalProblemUrl" @click="close(); openHydroProblem(practiceDetail)">
                      打开 Hydro
                    </el-button>
                  </div>
                  </template>
                </ProgrammingToolbarShell>
                <el-alert
                  v-if="practiceProgrammingResult"
                  class="code-submit-feedback"
                  :type="programmingFeedbackType(practiceProgrammingResult)"
                  :closable="false"
                  show-icon
                >
                  <template #title>{{ programmingFeedbackTitle(practiceProgrammingResult) }}</template>
                  <div class="code-submit-meta">
                    <span>状态：{{ practiceProgrammingResult.status || '-' }}</span>
                    <span>语言：{{ languageLabel(practiceProgrammingResult.language || practiceAnswer.language) }}</span>
                    <span v-if="practiceProgrammingResult.externalSubmissionId">Hydro提交：{{ practiceProgrammingResult.externalSubmissionId }}</span>
                    <span v-if="practiceProgrammingResult.score !== null && practiceProgrammingResult.score !== undefined">
                      得分：{{ practiceProgrammingResult.score }} / {{ practiceProgrammingResult.maxScore || practiceDetail.defaultScore || '-' }}
                    </span>
                    <span v-if="practiceProgrammingResult.totalTestCaseCount">
                      测试点：{{ practiceProgrammingResult.passedTestCaseCount }} / {{ practiceProgrammingResult.totalTestCaseCount }}
                    </span>
                  </div>
                  <div v-if="practiceProgrammingResult.message" class="code-submit-message">{{ practiceProgrammingResult.message }}</div>
                </el-alert>
                <CodeAnswerEditor
                  v-model="practiceAnswer.code"
                  :language="practiceAnswer.language"
                  :language-label="languageLabel(practiceAnswer.language)"
                  :rows="18"
                />
              </div>
              <MaterialQuestionAnswerPanel
                v-else-if="practiceDetail.type === 'material'"
                :model-value="practiceChildAnswers"
                :results="practiceChildResults"
                :material="practiceDetail"
                :rows="18"
                @update:model-value="updatePracticeChildAnswers"
              />
              <QuestionAnswerHost
                v-else
                :model-value="practiceAnswer"
                :question="practiceDetail"
                :type="practiceDetail.type"
                :rows="18"
                @update:model-value="updatePracticeAnswer"
              />
            </div>
          </template>
        </QuestionAnswerLayout>

        <el-alert
          v-if="practiceDetail.status !== 'published'"
          title="未发布题目只可预览或进入编辑模式，发布后才能按学生方式判分。"
          type="warning"
          show-icon
          :closable="false"
          class="batch-alert"
        />
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
        <el-button :icon="Edit" @click="practiceDetail && editQuestionFromPractice()">进入编辑模式</el-button>
        <el-button
          type="primary"
          :loading="practiceProgrammingSubmitLoading"
          :disabled="practiceDetail?.status !== 'published' || (practiceDetail?.type === 'programming' && !practiceHydroAccountId)"
          @click="practiceDetail?.type === 'programming' ? submitPracticeProgrammingAnswer() : checkPracticeAnswer()"
        >
          {{ practiceDetail?.type === 'programming' ? '提交 Hydro 评测' : '提交作答' }}
        </el-button>
      </template>
    </el-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useQuestionPageContext } from '../composables/questionPageContext';
import AnswerFeedback from '../../../components/AnswerFeedback.vue';
import CodeAnswerEditor from '../../../components/CodeAnswerEditor.vue';
import MaterialQuestionAnswerPanel from '../../../components/MaterialQuestionAnswerPanel.vue';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../../../components/ProgrammingToolbarShell.vue';
import QuestionAnswerHost from '../../../components/QuestionAnswerHost.vue';
import QuestionAnswerLayout from '../../../components/QuestionAnswerLayout.vue';

export default defineComponent({
  components: { AnswerFeedback, CodeAnswerEditor, MaterialQuestionAnswerPanel, MarkdownRenderer, ProgrammingToolbarShell, QuestionAnswerHost, QuestionAnswerLayout },
  setup: useQuestionPageContext,
});
</script>
