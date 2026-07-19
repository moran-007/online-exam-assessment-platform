<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">题库</h1>
      <div class="toolbar">
        <el-input
          v-model="filter.keyword"
          clearable
          placeholder="题目关键词"
          style="width: 200px"
          @keyup.enter="loadFirstPage"
          @clear="loadFirstPage"
        />
        <el-select v-model="filter.type" clearable placeholder="题型" style="width: 140px" @change="loadFirstPage">
          <el-option v-for="type in typeOptions" :key="type.value" :label="type.label" :value="type.value" />
        </el-select>
        <el-select v-model="filter.difficulty" clearable placeholder="难度" style="width: 120px" @change="loadFirstPage">
          <el-option v-for="level in [1, 2, 3, 4, 5]" :key="level" :label="`${level} 星`" :value="level" />
        </el-select>
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button
          v-if="canBatchAddWrong"
          type="success"
          :icon="Check"
          :disabled="!selectedQuestionIds.length"
          @click="batchAddWrongQuestions"
        >
          加入错题本
        </el-button>
      </div>
    </div>

    <div class="question-list-only">
      <div class="panel question-table-panel">
        <el-table
          class="question-list-table"
          :data="items"
          height="100%"
          :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
          highlight-current-row
          @row-click="selectQuestion"
          @selection-change="handleSelectionChange"
          @sort-change="handleQuestionSortChange"
        >
          <el-table-column v-if="canBatchAddWrong" type="selection" width="48" />
          <el-table-column prop="title" label="题目" min-width="260" sortable="custom">
            <template #default="{ row }">
              <div class="question-title-cell"><strong>{{ row.title }}</strong></div>
            </template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="150" />
          <el-table-column prop="type" label="题型" width="110" sortable="custom">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="difficulty" label="难度" width="82" sortable="custom" />
          <el-table-column v-if="showMediumColumns" prop="defaultScore" label="分值" width="82" sortable="custom" />
          <el-table-column v-if="showMediumColumns" label="知识点" min-width="170">
            <template #default="{ row }">
              <el-tag
                v-for="point in row.knowledgePoints || []"
                :key="point.id"
                size="small"
                type="success"
                effect="plain"
                class="clickable-tag"
                @click.stop="filterByKnowledgePoint(point)"
              >
                {{ point.name }}
              </el-tag>
              <span v-if="!(row.knowledgePoints || []).length" class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" label="标签" min-width="170">
            <template #default="{ row }">
              <el-tag
                v-for="tag in row.tags || []"
                :key="tag.id"
                size="small"
                effect="plain"
                class="clickable-tag"
                @click.stop="filterByTag(tag)"
              >
                {{ tag.name }}
              </el-tag>
              <span v-if="!(row.tags || []).length" class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button size="small" :icon="View" @click.stop="selectQuestion(row)">答题</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="table-footer">
          <span class="muted">共 {{ pagination.total }} 道可见题目</span>
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

    <el-dialog v-model="practiceVisible" title="题目作答" :width="practiceDialogWidth">
      <template v-if="detail">
        <div class="paper-preview-head answer-dialog-head">
          <div>
            <h2>{{ detail.title }}</h2>
            <span class="muted">{{ detail.courseName }} · {{ typeLabel(detail.type) }} · {{ detail.defaultScore }} 分</span>
          </div>
          <div class="toolbar">
            <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
              <el-radio-button label="side">左右</el-radio-button>
              <el-radio-button label="stack">上下</el-radio-button>
            </el-radio-group>
            <el-tag type="success">公开</el-tag>
          </div>
        </div>

        <QuestionAnswerLayout :mode="answerLayout" framed>
          <template #statement>
            <MarkdownRenderer
              :source="detail.content"
              :public-question-id="detail.id"
              :asset-access-token="detail.assetAccessToken"
            />
          </template>

          <template #answer>
            <div class="question-answer-body">
              <div v-if="detail.type === 'programming'" class="programming-answer">
                <ProgrammingToolbarShell :summary="languageLabel(answer.language)">
                  <template #badge>
                    <el-tag v-if="!matchedHydroAccounts.length" type="warning" size="small">无账号</el-tag>
                  </template>
                  <template #default="{ close }">
                    <div class="programming-toolbar">
                      <span class="programming-language-label">语言</span>
                      <el-select v-model="answer.language" style="width: 170px" @change="close">
                        <el-option
                          v-for="language in languageOptionsFor(detail)"
                          :key="language"
                          :label="languageLabel(language)"
                          :value="language"
                        />
                      </el-select>
                      <el-tag v-if="detail.programmingRef?.platformBaseUrl || detail.programmingRef?.externalProblemUrl" type="info">
                        来源：{{ hydroSourceLabel(detail.programmingRef) }}
                      </el-tag>
                      <el-tag v-if="detail.programmingRef?.domainId" type="info">
                        域：{{ detail.programmingRef.domainName || detail.programmingRef.domainId }}
                      </el-tag>
                      <el-tag v-if="detail.programmingRef?.externalProblemId" type="success">
                        {{ detail.programmingRef.externalProblemId }}
                      </el-tag>
                      <span class="programming-language-label">账号</span>
                      <el-select
                        v-model="selectedHydroAccountId"
                        :disabled="!matchedHydroAccounts.length"
                        placeholder="选择提交账号"
                        style="width: 230px"
                        @change="close"
                      >
                        <el-option
                          v-for="account in matchedHydroAccounts"
                          :key="account.id"
                          :label="hydroAccountLabel(account)"
                          :value="account.id"
                        />
                      </el-select>
                      <el-tag v-if="!matchedHydroAccounts.length" type="warning">无同站点账号</el-tag>
                      <el-button :disabled="!detail.programmingRef?.externalProblemUrl" @click="close(); openHydroProblem(detail)">打开 Hydro</el-button>
                    </div>
                  </template>
                </ProgrammingToolbarShell>
                <el-alert
                  v-if="programmingResult"
                  class="code-submit-feedback"
                  :type="programmingFeedbackType(programmingResult)"
                  :closable="false"
                  show-icon
                >
                  <template #title>{{ programmingFeedbackTitle(programmingResult) }}</template>
                  <div class="code-submit-meta">
                    <span>状态：{{ programmingResult.status }}</span>
                    <span>语言：{{ languageLabel(programmingResult.language) }}</span>
                    <span v-if="programmingResult.externalSubmissionId">Hydro提交：{{ programmingResult.externalSubmissionId }}</span>
                    <span v-if="programmingResult.score !== null && programmingResult.score !== undefined">
                      得分：{{ programmingResult.score }} / {{ programmingResult.maxScore || detail.defaultScore || '-' }}
                    </span>
                    <span v-if="programmingResult.totalTestCaseCount">
                      测试点：{{ programmingResult.passedTestCaseCount }} / {{ programmingResult.totalTestCaseCount }}
                    </span>
                  </div>
                  <div v-if="programmingResult.message" class="code-submit-message">{{ programmingResult.message }}</div>
                </el-alert>
                <CodeAnswerEditor
                  v-model="answer.code"
                  :language="answer.language"
                  :language-label="languageLabel(answer.language)"
                  :rows="18"
                />
              </div>
              <MaterialQuestionAnswerPanel
                v-else-if="detail.type === 'material'"
                :model-value="childAnswers"
                :results="childResults"
                :material="detail"
                :rows="18"
                :public-question-id="detail.id"
                :asset-access-token="detail.assetAccessToken"
                @update:model-value="mergeChildAnswers"
              />
              <QuestionAnswerHost
                v-else
                :model-value="answer"
                :question="detail"
                :type="detail.type"
                :rows="isObjectiveQuestionType(detail.type) ? 5 : 18"
                :public-question-id="detail.id"
                :asset-access-token="detail.assetAccessToken"
                @update:model-value="mergeAnswer"
              />
            </div>
          </template>
        </QuestionAnswerLayout>

        <el-alert
          v-if="detail.type !== 'programming' && result"
          :title="`${result.message}，得分 ${result.score} / ${result.totalScore}`"
          :type="result.isCorrect ? 'success' : result.isCorrect === false ? 'error' : 'warning'"
          show-icon
          :closable="false"
          class="batch-alert"
        />
        <AnswerFeedback v-if="detail.type !== 'programming'" :result="result" />
      </template>
      <template #footer>
        <el-button @click="practiceVisible = false">关闭</el-button>
        <el-button :icon="Delete" @click="clearAnswer">清空</el-button>
        <el-button
          type="primary"
          :icon="Check"
          :loading="programmingSubmitLoading"
          :disabled="detail?.type === 'programming' && getToken() && !selectedHydroAccountId"
          @click="detail?.type === 'programming' ? submitProgrammingAnswer() : checkAnswer()"
        >
          {{ detail?.type === 'programming' ? '提交 Hydro 评测' : '提交作答' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { Check, Delete, Refresh, Search, View } from '@element-plus/icons-vue';
import AnswerFeedback from '../../../components/AnswerFeedback.vue';
import CodeAnswerEditor from '../../../components/CodeAnswerEditor.vue';
import MaterialQuestionAnswerPanel from '../../../components/MaterialQuestionAnswerPanel.vue';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../../../components/ProgrammingToolbarShell.vue';
import QuestionAnswerHost from '../../../components/QuestionAnswerHost.vue';
import QuestionAnswerLayout from '../../../components/QuestionAnswerLayout.vue';
import { usePublicQuestionPage } from '../composables/usePublicQuestionPage';

const {
  showMediumColumns, typeOptions, items, detail, result, programmingResult,
  programmingSubmitLoading, practiceVisible, answerLayout, selectedHydroAccountId,
  answer, childAnswers, childResults, filter, pagination, pageSizes, canBatchAddWrong,
  selectedQuestionIds, practiceDialogWidth, matchedHydroAccounts, load, loadFirstPage,
  handleQuestionSortChange, filterByTag, filterByKnowledgePoint, handleSizeChange,
  handleCurrentChange, selectQuestion, handleSelectionChange, batchAddWrongQuestions,
  checkAnswer, clearAnswer, mergeAnswer, mergeChildAnswers, submitProgrammingAnswer,
  openHydroProblem, hydroSourceLabel, typeLabel, getToken, isObjectiveQuestionType,
  languageOptionsFor, languageLabel, hydroAccountLabel, programmingFeedbackType,
  programmingFeedbackTitle,
} = usePublicQuestionPage();
</script>
