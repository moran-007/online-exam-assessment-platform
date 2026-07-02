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
        <el-tag :type="remainingType">剩余 {{ remainingText }}</el-tag>
        <el-tag>{{ answeredCount }} / {{ totalCount }}</el-tag>
        <el-tooltip :content="asideCollapsed ? '展开答题卡' : '收起答题卡'" placement="bottom">
          <el-button :icon="asideCollapsed ? Expand : Fold" @click="toggleAside" />
        </el-tooltip>
        <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
          <el-radio-button label="side">左右</el-radio-button>
          <el-radio-button label="stack">上下</el-radio-button>
        </el-radio-group>
        <el-button :icon="Upload" :disabled="autoSubmitting" @click="saveAll">保存</el-button>
        <el-button type="primary" :icon="Check" :loading="autoSubmitting" @click="submit">提交</el-button>
      </div>
    </div>

    <div class="exam-layout" :class="{ 'is-aside-collapsed': asideCollapsed }">
      <main class="exam-main">
        <template v-if="visibleEntries.length">
          <section
            v-for="entry in visibleEntries"
            :id="`question-${entry.question.questionId}`"
            :key="entry.question.questionId"
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
                <el-tag v-if="isFlagged(entry.question.questionId)" type="warning">有疑问</el-tag>
                <el-tag>{{ entry.question.score }} 分</el-tag>
              </div>
            </div>

            <QuestionAnswerLayout :mode="answerLayout">
              <template #statement>
                <h2 class="exam-question-title">{{ entry.question.title || `第 ${entry.index + 1} 题` }}</h2>
                <MarkdownRenderer :source="entry.question.content" />
              </template>

              <template #answer>
                <div class="question-answer-body">
                  <div v-if="entry.question.type === 'programming'" class="programming-answer">
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
                        <el-button
                          type="primary"
                          :icon="Upload"
                          :loading="Boolean(codeSubmitLoading[entry.question.questionId])"
                          :disabled="!selectedHydroAccountIds[entry.question.questionId]"
                          @click="close(); submitCode(entry)"
                        >
                          提交代码
                        </el-button>
                        <el-button
                          v-if="codeSubmitFeedback[entry.question.questionId]?.submissionId"
                          :icon="Refresh"
                          :loading="Boolean(codeSubmitLoading[entry.question.questionId])"
                          @click="close(); refreshSubmission(entry.question.questionId)"
                        >
                          刷新结果
                        </el-button>
                      </div>
                      </template>
                    </ProgrammingToolbarShell>
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
                          得分：{{ codeSubmitFeedback[entry.question.questionId].score }}
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
                  <div v-else-if="isSplitQuestion(entry.question.type)" class="programming-answer">
                    <div class="programming-toolbar">
                      <span class="programming-language-label">作答</span>
                      <el-tag>{{ typeLabel(entry.question.type) }}</el-tag>
                    </div>
                    <el-input
                      v-model="answers[entry.question.questionId].text"
                      class="answer-input subjective-answer-input"
                      type="textarea"
                      :rows="22"
                      placeholder="填写答案"
                    />
                  </div>
                  <template v-else>
                    <div class="programming-toolbar">
                      <span class="programming-language-label">作答</span>
                      <el-tag>{{ typeLabel(entry.question.type) }}</el-tag>
                    </div>
                    <el-radio-group
                      v-if="['single_choice', 'true_false'].includes(entry.question.type)"
                      v-model="answers[entry.question.questionId].selectedOptionIds[0]"
                      class="answer-options"
                    >
                      <el-radio
                        v-for="option in entry.question.options"
                        :key="option.optionId"
                        :label="option.optionId"
                        class="answer-option"
                      >
                        <span class="option-choice">
                          <strong>{{ option.label }}.</strong>
                          <MarkdownRenderer :source="option.content" />
                        </span>
                      </el-radio>
                    </el-radio-group>

                    <el-checkbox-group
                      v-else-if="entry.question.type === 'multiple_choice'"
                      v-model="answers[entry.question.questionId].selectedOptionIds"
                      class="answer-options"
                    >
                      <el-checkbox
                        v-for="option in entry.question.options"
                        :key="option.optionId"
                        :label="option.optionId"
                        class="answer-option"
                      >
                        <span class="option-choice">
                          <strong>{{ option.label }}.</strong>
                          <MarkdownRenderer :source="option.content" />
                        </span>
                      </el-checkbox>
                    </el-checkbox-group>

                    <FillBlankAnswerInputs
                      v-else-if="entry.question.type === 'fill_blank'"
                      v-model="answers[entry.question.questionId].blanks"
                      :count="blankCountFor(entry.question)"
                    />
                    <el-input
                      v-else
                      v-model="answers[entry.question.questionId].text"
                      class="answer-input"
                      type="textarea"
                      :rows="6"
                      placeholder="填写答案"
                    />
                  </template>
                </div>
              </template>
            </QuestionAnswerLayout>

            <div class="question-actions">
              <el-button :icon="Flag" :type="isFlagged(entry.question.questionId) ? 'warning' : 'default'" @click="toggleFlag(entry.question.questionId)">
                {{ isFlagged(entry.question.questionId) ? '取消标疑' : '标记疑问' }}
              </el-button>
              <el-button :icon="Delete" @click="clearAnswer(entry.question.questionId)">清除答案</el-button>
            </div>
          </section>
        </template>

        <el-empty v-else description="暂无题目" />

        <div v-if="totalCount" class="exam-stepbar">
          <el-button :icon="ArrowLeft" :disabled="currentIndex <= 0" @click="goQuestion(currentIndex - 1)">上一题</el-button>
          <el-button type="primary" :icon="ArrowRight" :disabled="currentIndex >= totalCount - 1" @click="goQuestion(currentIndex + 1)">
            下一题
          </el-button>
        </div>
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
            <el-button :icon="Delete" :disabled="!currentQuestionId" @click="clearCurrentAnswer">清除本题</el-button>
            <el-button :icon="Upload" :disabled="autoSubmitting" @click="saveAll">保存全部</el-button>
            <el-button type="primary" :icon="Check" :loading="autoSubmitting" @click="submit">提交试卷</el-button>
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

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, ArrowRight, Check, Close, Delete, Expand, Flag, Fold, Link, Refresh, Upload } from '@element-plus/icons-vue';
import { api, getToken } from '../api';
import CodeAnswerEditor from '../components/CodeAnswerEditor.vue';
import FillBlankAnswerInputs from '../components/FillBlankAnswerInputs.vue';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../components/ProgrammingToolbarShell.vue';
import QuestionAnswerLayout from '../components/QuestionAnswerLayout.vue';

const route = useRoute();
const router = useRouter();
const exam = ref(null);
const paper = reactive({ sections: [] });
const attemptId = ref('');
const attemptStartedAt = ref('');
const serverOffsetMs = ref(0);
const clockNow = ref(Date.now());
const answers = reactive({});
const flagged = reactive({});
const codeSubmitLoading = reactive({});
const codeSubmitFeedback = reactive({});
const selectedHydroAccountIds = reactive({});
const currentIndex = ref(0);
const answerLayout = ref('side');
const asideCollapsed = ref(localStorage.getItem('exam-aside-collapsed') === 'true');
const hydroAccounts = ref([]);
const autoSubmitting = ref(false);
const submitted = ref(false);
const simulateStudentId = computed(() => String(route.query.simulateStudentId || ''));
const isSimulating = computed(() => Boolean(simulateStudentId.value));
let clockTimer = null;
let statusTimer = null;
let autosaveTimer = null;
let autosaveInterval = null;
let answersHydrating = false;
let saveInFlight = false;
let pendingAutosave = false;
const answersDirty = ref(false);
const warnedThresholds = new Set();
const objectiveQuestionTypes = new Set(['single_choice', 'multiple_choice', 'true_false', 'fill_blank']);

const flatQuestions = computed(() => {
  let index = 0;
  return paper.sections.flatMap((section) =>
    section.questions.map((question) => ({
      question,
      sectionTitle: section.title,
      index: index++,
    })),
  );
});

const totalCount = computed(() => flatQuestions.value.length);
const currentEntry = computed(() => flatQuestions.value[currentIndex.value] ?? null);
const currentQuestionId = computed(() => currentEntry.value?.question.questionId ?? '');
const visibleEntries = computed(() => (currentEntry.value ? [currentEntry.value] : []));
const answeredCount = computed(() => flatQuestions.value.filter((entry) => isAnswered(entry.question.questionId)).length);
const flaggedCount = computed(() => flatQuestions.value.filter((entry) => isFlagged(entry.question.questionId)).length);
const progressPercent = computed(() => (totalCount.value ? Math.round((answeredCount.value / totalCount.value) * 100) : 0));
const serverNowMs = computed(() => clockNow.value - serverOffsetMs.value);
const deadlineMs = computed(() => {
  if (!exam.value) return serverNowMs.value;
  const started = new Date(attemptStartedAt.value || exam.value.serverTime || Date.now()).getTime();
  const attemptEnd = started + Number(exam.value.durationMinutes || 0) * 60 * 1000;
  const examEnd = new Date(exam.value.endTime || attemptEnd).getTime();
  return Math.min(attemptEnd, examEnd);
});
const remainingMs = computed(() => Math.max(0, deadlineMs.value - serverNowMs.value));
const remainingText = computed(() => formatDuration(remainingMs.value));
const remainingType = computed(() => {
  if (remainingMs.value <= 60 * 1000) return 'danger';
  if (remainingMs.value <= 10 * 60 * 1000) return 'warning';
  return 'success';
});

watch(
  answers,
  () => {
    if (!answersHydrating) {
      scheduleAutosave();
    }
  },
  { deep: true },
);

async function load() {
  const entered = isSimulating.value
    ? await api(`/student/simulate/exams/${route.params.examId}/enter`, {
        method: 'POST',
        body: { studentId: simulateStudentId.value },
      })
    : await api(`/student/exams/${route.params.examId}/enter`, { method: 'POST' });
  attemptId.value = entered.attemptId;
  let data = entered;

  if (!entered.answers) {
    data = isSimulating.value
      ? await api(`/student/simulate/attempts/${entered.attemptId}?studentId=${simulateStudentId.value}`)
      : await api(`/student/attempts/${entered.attemptId}`);
  }

  exam.value = data.exam;
  attemptStartedAt.value = data.attemptStartedAt || data.exam?.serverTime || new Date().toISOString();
  serverOffsetMs.value = Date.now() - new Date(data.exam?.serverTime || Date.now()).getTime();
  paper.sections = data.paper.sections;
  await loadHydroAccounts();
  answersHydrating = true;
  try {
    resetAnswers();
    applySavedAnswers(data.answers ?? []);
  } finally {
    answersHydrating = false;
  }
  answersDirty.value = false;
  loadFlags();
  startClock();
  startStatusPolling();
  startAutosave();
}

function emptyAnswer() {
  return {
    selectedOptionIds: [],
    blanks: [{ index: 1, value: '' }],
    text: '',
    code: '',
    language: 'cc.cc17o2',
  };
}

function resetAnswers() {
  Object.keys(answers).forEach((key) => delete answers[key]);
  Object.keys(selectedHydroAccountIds).forEach((key) => delete selectedHydroAccountIds[key]);
  for (const entry of flatQuestions.value) {
    answers[entry.question.questionId] = {
      ...emptyAnswer(),
      blanks: blankAnswerList(entry.question),
      language: languageOptionsFor(entry.question)[0] || 'cc.cc17o2',
    };
    if (entry.question.type === 'programming') {
      selectedHydroAccountIds[entry.question.questionId] = defaultHydroAccountId(entry.question);
    }
  }
}

function applySavedAnswers(savedAnswers) {
  for (const saved of savedAnswers) {
    if (!answers[saved.questionId]) continue;
    const answer = saved.answer ?? {};
    answers[saved.questionId].selectedOptionIds = Array.isArray(answer.selectedOptionIds)
      ? answer.selectedOptionIds.filter(Boolean)
      : [];
    const question = flatQuestions.value.find((entry) => entry.question.questionId === saved.questionId)?.question;
    answers[saved.questionId].blanks = blankAnswerList(question, answer.blanks);
    answers[saved.questionId].text = typeof answer.text === 'string' ? answer.text : '';
    answers[saved.questionId].code = typeof answer.code === 'string' ? answer.code : typeof answer.text === 'string' ? answer.text : '';
    answers[saved.questionId].language = typeof answer.language === 'string' ? answer.language : 'cc.cc17o2';
    if (['judge_pending', 'judge_done'].includes(saved.status) || saved.autoResult?.latestSubmissionId) {
      codeSubmitFeedback[saved.questionId] = buildSubmissionFeedback(
        {
          submissionId: saved.autoResult?.latestSubmissionId || answer.hydro?.submissionId || '',
          externalSubmissionId: saved.autoResult?.externalSubmissionId || answer.hydro?.externalSubmissionId || '',
          status: saved.autoResult?.status || (saved.status === 'judge_done' ? 'accepted' : 'pending'),
          score: saved.score,
          language: answers[saved.questionId].language,
          mode: answer.hydro?.mode || saved.autoResult?.mode || 'direct',
          problemUrl: saved.autoResult?.problemUrl || answer.hydro?.problemUrl || '',
          recordUrl: saved.autoResult?.recordUrl || saved.autoResult?.result?.recordUrl || '',
          message: saved.autoResult?.message || (saved.status === 'judge_done' ? '判题结果已同步' : '等待 Hydro 判题结果'),
        },
        saved.autoResult?.status === 'accepted' ? 'success' : 'info',
      );
    }
  }
}

function isAnswered(questionId) {
  const answer = answers[questionId];
  if (!answer) return false;
  if (answer.selectedOptionIds?.filter(Boolean).length) return true;
  if (answer.blanks?.some((blank) => String(blank.value ?? '').trim())) return true;
  if (String(answer.code ?? '').trim()) return true;
  if (String(answer.text ?? '').trim()) return true;
  return false;
}

function isFlagged(questionId) {
  return Boolean(flagged[questionId]);
}

function payloadFor(questionId) {
  const answer = answers[questionId];
  if (answer.selectedOptionIds?.filter(Boolean).length) {
    return { selectedOptionIds: answer.selectedOptionIds.filter(Boolean) };
  }
  if (answer.blanks?.some((blank) => String(blank.value ?? '').trim())) {
    return { blanks: answer.blanks };
  }
  if (String(answer.code ?? '').trim()) {
    return {
      text: answer.code,
      code: answer.code,
      language: answer.language || 'cc.cc17o2',
    };
  }
  if (String(answer.text ?? '').trim()) {
    return { text: answer.text };
  }
  return {};
}

function languageOptionsFor(question) {
  const languages = question.programmingRef?.languages || [];
  return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
}

function isSplitQuestion(type) {
  return !objectiveQuestionTypes.has(type);
}

function blankCountFor(question) {
  const explicit = Number(question?.blankCount);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const answerBlanks = question?.answer?.blanks;
  if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
  return Math.max(1, countBlankMarkers(question?.content));
}

function blankAnswerList(question, existing = []) {
  const source = Array.isArray(existing) ? existing : [];
  const count = Math.max(blankCountFor(question), ...source.map((blank) => Number(blank?.index) || 0), 1);
  return Array.from({ length: count }, (_, index) => {
    const blankIndex = index + 1;
    const current = source.find((blank) => Number(blank?.index) === blankIndex);
    return { index: blankIndex, value: current?.value ?? '' };
  });
}

function countBlankMarkers(content) {
  const matches = String(content || '').match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g);
  return matches?.length || 1;
}

function typeLabel(value) {
  const map = {
    single_choice: '单选题',
    multiple_choice: '多选题',
    true_false: '判断题',
    fill_blank: '填空题',
    short_answer: '简答题',
    programming: '编程题',
    material: '材料题',
    file_upload: '文件上传题',
    scratch_project: 'Scratch 项目题',
    arduino_project: 'Arduino 项目题',
  };
  return map[value] ?? value;
}

function languageLabel(language) {
  const labels = {
    'cc.cc17o2': 'C++17(O2)',
    'cc.cc17': 'C++17',
    'cc.cc14o2': 'C++14(O2)',
    'cc.cc14': 'C++14',
    'cc.cc11o2': 'C++11(O2)',
    'cc.cc11': 'C++11',
    'py.py3': 'Python 3',
    'py.py2': 'Python 2',
    'cc.cc20o2': 'C++20(O2)',
    'cc.cc20': 'C++20',
    cpp17: 'C++17',
    python3: 'Python 3',
    java: 'Java',
    c: 'C',
    cc: 'C++',
    pas: 'Pascal',
  };
  return labels[language] ?? language;
}

function openHydroProblem(question) {
  const url = question.programmingRef?.externalProblemUrl;
  if (!url) {
    ElMessage.warning('该题尚未配置 Hydro 链接');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function loadHydroAccounts() {
  try {
    const data = await api('/hydro/my/accounts');
    hydroAccounts.value = data.items ?? data ?? [];
  } catch {
    hydroAccounts.value = [];
  }
}

function defaultHydroAccountId(question) {
  const matched = matchedHydroAccountsFor(question);
  const boundAccountId = question?.programmingRef?.accountId;
  return matched.find((account) => account.id === boundAccountId)?.id || matched[0]?.id || '';
}

function matchedHydroAccountsFor(question) {
  const targetBaseUrl = programmingRefBaseUrl(question?.programmingRef);
  if (!targetBaseUrl) return [];
  return hydroAccounts.value.filter(
    (account) => account.bindStatus === 'bound' && sameHydroBaseUrl(account.platformBaseUrl, targetBaseUrl),
  );
}

function programmingRefBaseUrl(ref) {
  const raw = ref?.platformBaseUrl || baseUrlFromProblemUrl(ref?.externalProblemUrl);
  return raw ? normalizeBaseUrl(raw) : '';
}

function baseUrlFromProblemUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/+$/, '');
}

function shortHost(value) {
  try {
    return new URL(normalizeBaseUrl(value)).host;
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }
}

function sameHydroBaseUrl(left, right) {
  const leftHost = canonicalHost(left);
  const rightHost = canonicalHost(right);
  return Boolean(leftHost && rightHost && leftHost === rightHost);
}

function canonicalHost(value) {
  return shortHost(value).toLowerCase().replace(/^www\./, '');
}

function hydroAccountLabel(account) {
  return `${account.loginUsername || account.hydroUsername || 'Hydro账号'} · ${shortHost(account.platformBaseUrl)}`;
}

function hydroSourceLabel(ref) {
  const host = shortHost(programmingRefBaseUrl(ref));
  const domain = ref?.domainName || ref?.domainId || 'system';
  return [host, domain && domain !== 'system' ? domain : 'system'].filter(Boolean).join(' / ');
}

async function submitCode(entry) {
  const question = entry.question;
  const answer = answers[question.questionId];
  const accountId = selectedHydroAccountIds[question.questionId];
  if (!attemptId.value || !answer) return;
  if (!String(answer.code ?? '').trim()) {
    ElMessage.warning('请先填写代码');
    return;
  }
  if (!accountId) {
    ElMessage.warning('请选择当前题目来源站点下的提交账号');
    return;
  }

  codeSubmitLoading[question.questionId] = true;
  try {
    const result = await api(`/hydro/attempts/${attemptId.value}/questions/${question.questionId}/submit-code`, {
      method: 'POST',
      body: {
        language: answer.language || languageOptionsFor(question)[0],
        code: answer.code,
        accountId,
      },
    });
    codeSubmitFeedback[question.questionId] = buildSubmissionFeedback(result, 'success');
    ElMessage.success(result.message || '代码已提交');
  } catch (error) {
    codeSubmitFeedback[question.questionId] = {
      type: 'error',
      title: '代码提交失败',
      message: error.message || '代码提交失败',
      status: '',
      language: answer.language,
      externalSubmissionId: '',
      score: null,
      submissionId: '',
    };
    ElMessage.error(error.message || '代码提交失败');
  } finally {
    codeSubmitLoading[question.questionId] = false;
  }
}

async function refreshSubmission(questionId) {
  const feedback = codeSubmitFeedback[questionId];
  if (!feedback?.submissionId) return;
  codeSubmitLoading[questionId] = true;
  try {
    const detail = await api(`/hydro/submissions/${feedback.submissionId}`);
    codeSubmitFeedback[questionId] = buildSubmissionFeedback(detail, detail.status === 'accepted' ? 'success' : 'info');
    ElMessage.success('判题结果已刷新');
  } catch (error) {
    ElMessage.error(error.message || '刷新失败');
  } finally {
    codeSubmitLoading[questionId] = false;
  }
}

function buildSubmissionFeedback(result, fallbackType = 'info') {
  const status = result.status || '';
  const accepted = status === 'accepted';
  return {
    type: accepted ? 'success' : fallbackType,
    title: result.mode === 'manual' ? '本地提交已记录' : accepted ? '判题通过' : '代码提交已记录',
    message: result.message || '',
    status,
    language: result.language || '',
    externalSubmissionId: result.externalSubmissionId || '',
    score: result.score ?? null,
    submissionId: result.submissionId || '',
    problemUrl: result.problemUrl || '',
    recordUrl: result.recordUrl || '',
  };
}

function clearAnswer(questionId) {
  if (!answers[questionId]) return;
  const question = flatQuestions.value.find((entry) => entry.question.questionId === questionId)?.question;
  Object.assign(answers[questionId], {
    ...emptyAnswer(),
    blanks: blankAnswerList(question),
    language: question ? languageOptionsFor(question)[0] || 'cc.cc17o2' : 'cc.cc17o2',
  });
  ElMessage.success('已清除答案');
}

function clearCurrentAnswer() {
  if (currentQuestionId.value) {
    clearAnswer(currentQuestionId.value);
  }
}

function toggleFlag(questionId) {
  if (!questionId) return;
  if (flagged[questionId]) {
    delete flagged[questionId];
  } else {
    flagged[questionId] = true;
  }
  persistFlags();
}

function toggleCurrentFlag() {
  toggleFlag(currentQuestionId.value);
}

function exitSimulation() {
  router.push('/exams');
}

function flagStorageKey() {
  return `exam-flags:${attemptId.value}`;
}

function loadFlags() {
  Object.keys(flagged).forEach((key) => delete flagged[key]);
  if (!attemptId.value) return;
  const raw = localStorage.getItem(flagStorageKey());
  const stored = raw ? JSON.parse(raw) : {};
  Object.entries(stored).forEach(([questionId, value]) => {
    if (value) flagged[questionId] = true;
  });
}

function persistFlags() {
  if (!attemptId.value) return;
  localStorage.setItem(flagStorageKey(), JSON.stringify(flagged));
}

function numberButtonClass(entry) {
  const questionId = entry.question.questionId;
  return {
    'question-nav-item': true,
    current: entry.index === currentIndex.value,
    answered: isAnswered(questionId),
    unanswered: !isAnswered(questionId),
    flagged: isFlagged(questionId),
  };
}

function numberTitle(entry) {
  const status = isAnswered(entry.question.questionId) ? '已答' : '未答';
  const flag = isFlagged(entry.question.questionId) ? '，有疑问' : '';
  return `第 ${entry.index + 1} 题：${status}${flag}`;
}

function goQuestion(index) {
  if (index < 0 || index >= totalCount.value) return;
  currentIndex.value = index;
}

function toggleAside() {
  asideCollapsed.value = !asideCollapsed.value;
  localStorage.setItem('exam-aside-collapsed', String(asideCollapsed.value));
}

function savePayload(finalizeEndedAttempt = false) {
  return {
    answers: flatQuestions.value.map((entry) => ({
      questionId: entry.question.questionId,
      answer: payloadFor(entry.question.questionId),
    })),
    finalizeEndedAttempt,
  };
}

function savePath() {
  return isSimulating.value
    ? `/student/simulate/attempts/${attemptId.value}/save-answers`
    : `/student/attempts/${attemptId.value}/save-answers`;
}

async function keepaliveSave(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    keepalive: true,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.code !== 0) {
    throw new Error(payload?.message || `请求失败：${response.status}`);
  }
  return payload.data;
}

async function saveAll(options = {}) {
  const { silent = false, finalizeEndedAttempt = false, keepalive = false, swallow = false } = options;
  if (!attemptId.value || submitted.value) return null;

  const body = savePayload(finalizeEndedAttempt);
  const requestBody = isSimulating.value ? { ...body, studentId: simulateStudentId.value } : body;
  const path = savePath();

  try {
    const result = keepalive
      ? await keepaliveSave(path, requestBody)
      : await api(path, { method: 'POST', body: requestBody });
    answersDirty.value = false;
    if (!silent) ElMessage.success('已保存');
    return result;
  } catch (error) {
    if (!silent) ElMessage.error(error.message || '保存失败');
    if (!swallow) throw error;
    return null;
  }
}

function scheduleAutosave() {
  if (!attemptId.value || submitted.value || autoSubmitting.value) return;
  answersDirty.value = true;
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    void flushAutosave();
  }, 1800);
}

function startAutosave() {
  if (autosaveInterval) window.clearInterval(autosaveInterval);
  autosaveInterval = window.setInterval(() => {
    void flushAutosave();
  }, 8000);
}

async function flushAutosave(options = {}) {
  if (!attemptId.value || submitted.value || autoSubmitting.value || !answersDirty.value) return null;
  if (saveInFlight) {
    pendingAutosave = true;
    return null;
  }

  saveInFlight = true;
  try {
    return await saveAll({ silent: true, swallow: true, ...options });
  } finally {
    saveInFlight = false;
    if (pendingAutosave) {
      pendingAutosave = false;
      void flushAutosave(options);
    }
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    void flushAutosave({ keepalive: true });
  }
}

function handlePageHide() {
  if (!answersDirty.value || !attemptId.value || submitted.value) return;
  void saveAll({ silent: true, keepalive: true, swallow: true });
}

async function finalizeRemoteEndedAttempt() {
  if (submitted.value || !attemptId.value) return;

  autoSubmitting.value = true;
  const result = await saveAll({
    silent: true,
    finalizeEndedAttempt: true,
    swallow: true,
  });
  submitted.value = true;
  ElMessage.warning(result?.finalized ? '考试已结束，已保存当前页面答案并交卷' : '考试已结束，系统已提交当前答卷');
  const query = isSimulating.value ? `?simulateStudentId=${simulateStudentId.value}` : '';
  router.push(`/student/attempts/${attemptId.value}/result${query}`);
}

async function submit(options = {}) {
  if (submitted.value || autoSubmitting.value) return;
  const { skipConfirm = false, auto = false } = options;
  const unanswered = totalCount.value - answeredCount.value;
  const flaggedText = flaggedCount.value ? `，其中 ${flaggedCount.value} 题已标疑` : '';
  if (!skipConfirm) {
    await ElMessageBox.confirm(`还有 ${unanswered} 题未作答${flaggedText}。提交后不能继续修改答案。`, '确认提交', { type: 'warning' });
  }
  autoSubmitting.value = true;
  try {
    await saveAll({ silent: auto, finalizeEndedAttempt: auto || remainingMs.value <= 0 });
    const result = await api(
      isSimulating.value
        ? `/student/simulate/attempts/${attemptId.value}/submit`
        : `/student/attempts/${attemptId.value}/submit`,
      {
        method: 'POST',
        body: isSimulating.value ? { studentId: simulateStudentId.value } : { confirm: true },
      },
    );
    submitted.value = true;
    ElMessage.success(auto ? '考试时间已到，系统已自动交卷' : '已提交');
    const query = isSimulating.value ? `?simulateStudentId=${simulateStudentId.value}` : '';
    router.push(`/student/attempts/${result.attemptId || attemptId.value}/result${query}`);
  } finally {
    if (!submitted.value) autoSubmitting.value = false;
  }
}

async function autoSubmitExam() {
  if (submitted.value || autoSubmitting.value || !attemptId.value) return;
  try {
    ElMessage.error('考试时间已到，正在自动交卷');
    await submit({ skipConfirm: true, auto: true });
  } catch (error) {
    autoSubmitting.value = false;
    ElMessage.error(error.message || '自动交卷失败，请手动提交');
  }
}

function startClock() {
  if (clockTimer) window.clearInterval(clockTimer);
  checkTimeWarnings();
  clockTimer = window.setInterval(() => {
    clockNow.value = Date.now();
    checkTimeWarnings();
  }, 1000);
}

function startStatusPolling() {
  if (statusTimer) window.clearInterval(statusTimer);
  statusTimer = window.setInterval(refreshAttemptStatus, 10_000);
}

async function refreshAttemptStatus() {
  if (!attemptId.value || submitted.value || autoSubmitting.value) return;
  try {
    const data = isSimulating.value
      ? await api(`/student/simulate/attempts/${attemptId.value}?studentId=${simulateStudentId.value}`)
      : await api(`/student/attempts/${attemptId.value}`);
    if (data.exam) {
      exam.value = data.exam;
      serverOffsetMs.value = Date.now() - new Date(data.exam.serverTime || Date.now()).getTime();
    }
    if (data.status && data.status !== 'in_progress') {
      await finalizeRemoteEndedAttempt();
    }
  } catch {
    // Keep local countdown/save behavior active; explicit save/submit actions will show any actionable error.
  }
}

function checkTimeWarnings() {
  const thresholds = [10 * 60 * 1000, 5 * 60 * 1000, 60 * 1000];
  for (const threshold of thresholds) {
    if (remainingMs.value <= threshold && remainingMs.value > 0 && !warnedThresholds.has(threshold)) {
      warnedThresholds.add(threshold);
      ElMessage.warning(`答题剩余 ${formatDuration(remainingMs.value)}`);
      return;
    }
  }

  if (remainingMs.value <= 0 && !warnedThresholds.has(0)) {
    warnedThresholds.add(0);
    autoSubmitExam();
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

onMounted(() => {
  window.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('beforeunload', handlePageHide);
  void load();
});

onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer);
  if (statusTimer) window.clearInterval(statusTimer);
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  if (autosaveInterval) window.clearInterval(autosaveInterval);
  window.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('beforeunload', handlePageHide);
});
</script>
