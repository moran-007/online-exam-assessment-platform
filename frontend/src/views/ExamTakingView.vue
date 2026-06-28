<template>
  <div class="page exam-page">
    <div class="page-head exam-head">
      <div>
        <h1 class="page-title">{{ exam?.name || '考试' }}</h1>
        <span class="muted">共 {{ totalCount }} 题，已答 {{ answeredCount }} 题，标疑 {{ flaggedCount }} 题</span>
      </div>
      <div class="toolbar">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button label="single">
            <el-icon><List /></el-icon>
            逐题
          </el-radio-button>
          <el-radio-button label="all">
            <el-icon><Grid /></el-icon>
            整卷
          </el-radio-button>
        </el-radio-group>
        <el-tag v-if="isSimulating" type="warning">教师模拟学生</el-tag>
        <el-button v-if="isSimulating" :icon="Close" @click="exitSimulation">退出模拟</el-button>
        <el-tag :type="remainingType">剩余 {{ remainingText }}</el-tag>
        <el-tag>{{ answeredCount }} / {{ totalCount }}</el-tag>
        <el-button :icon="Upload" @click="saveAll">保存</el-button>
        <el-button type="primary" :icon="Check" @click="submit">提交</el-button>
      </div>
    </div>

    <div class="exam-layout">
      <main class="exam-main">
        <template v-if="visibleEntries.length">
          <section
            v-for="entry in visibleEntries"
            :id="`question-${entry.question.questionId}`"
            :key="entry.question.questionId"
            class="question-card exam-question"
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

            <h2 class="exam-question-title">{{ entry.question.title || `第 ${entry.index + 1} 题` }}</h2>
            <MarkdownRenderer :source="entry.question.content" />

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

            <el-input
              v-else-if="entry.question.type === 'fill_blank'"
              v-model="answers[entry.question.questionId].blanks[0].value"
              class="answer-input"
              placeholder="填写答案"
            />
            <el-input
              v-else
              v-model="answers[entry.question.questionId].text"
              class="answer-input"
              type="textarea"
              :rows="6"
              placeholder="填写答案"
            />

            <div class="question-actions">
              <el-button :icon="Flag" :type="isFlagged(entry.question.questionId) ? 'warning' : 'default'" @click="toggleFlag(entry.question.questionId)">
                {{ isFlagged(entry.question.questionId) ? '取消标疑' : '标记疑问' }}
              </el-button>
              <el-button :icon="Delete" @click="clearAnswer(entry.question.questionId)">清除答案</el-button>
            </div>
          </section>
        </template>

        <el-empty v-else description="暂无题目" />

        <div v-if="viewMode === 'single' && totalCount" class="exam-stepbar">
          <el-button :icon="ArrowLeft" :disabled="currentIndex <= 0" @click="goQuestion(currentIndex - 1)">上一题</el-button>
          <el-button type="primary" :icon="ArrowRight" :disabled="currentIndex >= totalCount - 1" @click="goQuestion(currentIndex + 1)">
            下一题
          </el-button>
        </div>
      </main>

      <aside class="exam-aside panel">
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
          <el-button :icon="Upload" @click="saveAll">保存全部</el-button>
          <el-button type="primary" :icon="Check" @click="submit">提交试卷</el-button>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, ArrowRight, Check, Close, Delete, Flag, Grid, List, Upload } from '@element-plus/icons-vue';
import { api } from '../api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';

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
const viewMode = ref('single');
const currentIndex = ref(0);
const simulateStudentId = computed(() => String(route.query.simulateStudentId || ''));
const isSimulating = computed(() => Boolean(simulateStudentId.value));
let clockTimer = null;
const warnedThresholds = new Set();

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
const visibleEntries = computed(() => (viewMode.value === 'all' ? flatQuestions.value : currentEntry.value ? [currentEntry.value] : []));
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
  resetAnswers();
  applySavedAnswers(data.answers ?? []);
  loadFlags();
  startClock();
}

function emptyAnswer() {
  return {
    selectedOptionIds: [],
    blanks: [{ index: 1, value: '' }],
    text: '',
  };
}

function resetAnswers() {
  Object.keys(answers).forEach((key) => delete answers[key]);
  for (const entry of flatQuestions.value) {
    answers[entry.question.questionId] = emptyAnswer();
  }
}

function applySavedAnswers(savedAnswers) {
  for (const saved of savedAnswers) {
    if (!answers[saved.questionId]) continue;
    const answer = saved.answer ?? {};
    answers[saved.questionId].selectedOptionIds = Array.isArray(answer.selectedOptionIds)
      ? answer.selectedOptionIds.filter(Boolean)
      : [];
    answers[saved.questionId].blanks = Array.isArray(answer.blanks) && answer.blanks.length
      ? answer.blanks.map((blank, index) => ({
          index: blank.index ?? index + 1,
          value: blank.value ?? '',
        }))
      : [{ index: 1, value: '' }];
    answers[saved.questionId].text = typeof answer.text === 'string' ? answer.text : '';
  }
}

function isAnswered(questionId) {
  const answer = answers[questionId];
  if (!answer) return false;
  if (answer.selectedOptionIds?.filter(Boolean).length) return true;
  if (answer.blanks?.some((blank) => String(blank.value ?? '').trim())) return true;
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
  if (String(answer.text ?? '').trim()) {
    return { text: answer.text };
  }
  return {};
}

function clearAnswer(questionId) {
  if (!answers[questionId]) return;
  Object.assign(answers[questionId], emptyAnswer());
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

async function goQuestion(index) {
  if (index < 0 || index >= totalCount.value) return;
  currentIndex.value = index;
  if (viewMode.value === 'all') {
    await nextTick();
    document.getElementById(`question-${flatQuestions.value[index].question.questionId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }
}

async function saveAll() {
  const body = {
    answers: flatQuestions.value.map((entry) => ({
      questionId: entry.question.questionId,
      answer: payloadFor(entry.question.questionId),
    })),
  };
  const path = isSimulating.value
    ? `/student/simulate/attempts/${attemptId.value}/save-answers`
    : `/student/attempts/${attemptId.value}/save-answers`;
  await api(path, {
    method: 'POST',
    body: isSimulating.value ? { ...body, studentId: simulateStudentId.value } : body,
  });
  ElMessage.success('已保存');
}

async function submit() {
  const unanswered = totalCount.value - answeredCount.value;
  const flaggedText = flaggedCount.value ? `，其中 ${flaggedCount.value} 题已标疑` : '';
  await ElMessageBox.confirm(`还有 ${unanswered} 题未作答${flaggedText}。提交后不能继续修改答案。`, '确认提交', { type: 'warning' });
  await saveAll();
  const result = await api(
    isSimulating.value
      ? `/student/simulate/attempts/${attemptId.value}/submit`
      : `/student/attempts/${attemptId.value}/submit`,
    {
      method: 'POST',
      body: isSimulating.value ? { studentId: simulateStudentId.value } : { confirm: true },
    },
  );
  ElMessage.success('已提交');
  const query = isSimulating.value ? `?simulateStudentId=${simulateStudentId.value}` : '';
  router.push(`/student/attempts/${result.attemptId || attemptId.value}/result${query}`);
}

function startClock() {
  if (clockTimer) window.clearInterval(clockTimer);
  checkTimeWarnings();
  clockTimer = window.setInterval(() => {
    clockNow.value = Date.now();
    checkTimeWarnings();
  }, 1000);
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
    ElMessage.error('本次答题时间已到，请尽快提交');
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

onMounted(load);

onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer);
});
</script>
