<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">错题本</h1>
      <div class="toolbar">
        <el-button type="primary" :icon="Aim" :disabled="!items.length" @click="pickRandom">随机抽题</el-button>
        <el-button type="success" :icon="Document" :disabled="!items.length" @click="generateWrongPaper">错题组卷</el-button>
        <el-button :icon="Download" :disabled="!items.length" @click="exportVisible = true">导出错题</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </div>

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
        <div class="paper-preview-head">
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
                <div class="programming-toolbar">
                  <span class="programming-language-label">语言</span>
                  <el-select v-model="answer.language" style="width: 170px">
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
                    @click="openHydroProblem(practice.question)"
                  >
                    打开 Hydro
                  </el-button>
                </div>
                <CodeAnswerEditor
                  v-model="answer.code"
                  :language="answer.language"
                  :language-label="languageLabel(answer.language)"
                  :rows="18"
                />
              </div>
              <div v-else-if="isSplitPracticeQuestion(practice.question.type)" class="programming-answer">
                <div class="programming-toolbar">
                  <span class="programming-language-label">作答</span>
                  <el-tag>{{ typeLabel(practice.question.type) }}</el-tag>
                </div>
                <el-input
                  v-model="answer.text"
                  class="answer-input subjective-answer-input"
                  type="textarea"
                  :rows="18"
                  placeholder="填写答案"
                />
              </div>
              <template v-else>
                <div class="programming-toolbar">
                  <span class="programming-language-label">作答</span>
                  <el-tag>{{ typeLabel(practice.question.type) }}</el-tag>
                </div>
                <el-radio-group
                  v-if="['single_choice', 'true_false'].includes(practice.question.type)"
                  v-model="answer.selectedOptionIds[0]"
                  class="answer-options"
                >
                  <el-radio v-for="option in practice.question.options || []" :key="option.optionId" :label="option.optionId" class="answer-option">
                    <span class="option-choice">
                      <strong>{{ option.label }}.</strong>
                      <MarkdownRenderer :source="option.content" />
                    </span>
                  </el-radio>
                </el-radio-group>

                <el-checkbox-group v-else-if="practice.question.type === 'multiple_choice'" v-model="answer.selectedOptionIds" class="answer-options">
                  <el-checkbox v-for="option in practice.question.options || []" :key="option.optionId" :label="option.optionId" class="answer-option">
                    <span class="option-choice">
                      <strong>{{ option.label }}.</strong>
                      <MarkdownRenderer :source="option.content" />
                    </span>
                  </el-checkbox>
                </el-checkbox-group>

                <FillBlankAnswerInputs
                  v-else-if="practice.question.type === 'fill_blank'"
                  v-model="answer.blanks"
                  :count="blankCountFor(practice.question)"
                />
                <el-input v-else v-model="answer.text" class="answer-input" type="textarea" :rows="5" placeholder="填写答案" />
              </template>
            </div>
          </template>
        </QuestionAnswerLayout>

        <div class="toolbar question-actions">
          <el-button type="primary" :icon="Check" @click="checkPractice">提交练习</el-button>
          <el-button :icon="Delete" @click="clearPracticeAnswer">清空答案</el-button>
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
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Aim, Check, Delete, Document, Download, Hide, Link, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import AnswerFeedback from '../components/AnswerFeedback.vue';
import CodeAnswerEditor from '../components/CodeAnswerEditor.vue';
import FillBlankAnswerInputs from '../components/FillBlankAnswerInputs.vue';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import QuestionAnswerLayout from '../components/QuestionAnswerLayout.vue';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

const items = ref([]);
const router = useRouter();
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const candidates = ref([]);
const candidateKeyword = ref('');
const selectedCandidateId = ref('');
const practice = ref(null);
const practiceVisible = ref(false);
const practiceResult = ref(null);
const answerLayout = ref('side');
const exportVisible = ref(false);
const traceVisible = ref(false);
const traceEvents = ref([]);
const traceTitle = ref('');
const insights = reactive({
  sourceSummary: [],
  masteryCurve: [],
  reviewReminders: [],
  recentEvents: [],
});
const answer = reactive(emptyAnswer());
const exportForm = reactive({
  format: 'pdf',
  includeAnswers: true,
  includeAnalysis: true,
  includeWrongInfo: true,
});
const objectiveQuestionTypes = new Set(['single_choice', 'multiple_choice', 'true_false', 'fill_blank']);
const practiceDialogWidth = computed(() => (answerLayout.value === 'side' ? '1180px' : '860px'));

async function load() {
  const [wrongItems, insightData] = await Promise.all([
    api('/student/wrong-questions'),
    api('/student/wrong-questions/insights'),
  ]);
  items.value = wrongItems;
  Object.assign(insights, {
    sourceSummary: insightData.sourceSummary ?? [],
    masteryCurve: insightData.masteryCurve ?? [],
    reviewReminders: insightData.reviewReminders ?? [],
    recentEvents: insightData.recentEvents ?? [],
  });
}

async function loadCandidates() {
  const data = await api(`/questions/public/list${buildQuery({ pageSize: 30, keyword: candidateKeyword.value })}`);
  candidates.value = data.items;
  selectedCandidateId.value = candidates.value.some((question) => question.id === selectedCandidateId.value)
    ? selectedCandidateId.value
    : candidates.value[0]?.id || '';
}

async function addWrongQuestion() {
  if (!selectedCandidateId.value) return;
  await api('/student/wrong-questions', {
    method: 'POST',
    body: { questionId: selectedCandidateId.value },
  });
  ElMessage.success('已加入错题本');
  await load();
}

async function generateWrongPaper() {
  if (!items.value.length) return;
  await ElMessageBox.confirm(`将使用当前 ${items.value.length} 道错题生成个人练习卷，生成后可直接试答。`, '错题组卷', {
    type: 'info',
    confirmButtonText: '生成试卷',
    cancelButtonText: '取消',
  });
  const result = await api('/student/wrong-questions/paper', {
    method: 'POST',
    body: {
      name: `我的错题组卷 ${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`,
      count: items.value.length,
      random: false,
    },
  });
  ElMessage.success(`已生成 ${result.questionCount} 道题的错题卷`);
  router.push({
    path: `/papers/${result.paperId}/answer`,
    query: { return: '/student/wrong-questions' },
  });
}

async function exportWrongQuestions() {
  const task = await api('/exports/student/wrong-questions', {
    method: 'POST',
    body: {
      type: 'wrong_questions',
      ...exportForm,
    },
  });
  exportVisible.value = false;
  ElMessage.success(`错题导出任务已加入队列：${task.id?.slice?.(0, 8) ?? ''}，请到导出中心下载`);
}

function pickRandom() {
  if (!items.value.length) return;
  openPractice(items.value[Math.floor(Math.random() * items.value.length)]);
}

function openPractice(row) {
  practice.value = row;
  practiceVisible.value = true;
  clearPracticeAnswer();
}

async function checkPractice() {
  if (!practice.value) return;
  const payload = payloadForAnswer();
  practiceResult.value = await api(`/questions/${practice.value.question.id}/check-answer`, {
    method: 'POST',
    body: payload,
  });
  if (practiceResult.value?.isCorrect !== null && practiceResult.value?.isCorrect !== undefined) {
    await api(`/student/wrong-questions/${practice.value.question.id}/practice-result`, {
      method: 'POST',
      body: {
        answer: payload,
        isCorrect: Boolean(practiceResult.value.isCorrect),
        score: practiceResult.value.score ?? 0,
        totalScore: practiceResult.value.totalScore ?? practice.value.question.defaultScore ?? 0,
      },
    });
  }
  if (practiceResult.value?.isCorrect) {
    const questionId = practice.value.question.id;
    items.value = items.value.filter((item) => item.question.id !== questionId);
    practice.value = null;
    practiceVisible.value = false;
    await load();
    ElMessage.success('回答正确，已自动从错题本隐藏');
  } else if (practiceResult.value?.isCorrect === false) {
    await load();
    ElMessage.warning('已记录本次错题练习');
  }
}

async function hideWrongQuestion(row) {
  await updateWrongQuestionStatus(row, 'ignored');
  ElMessage.success('已移出错题本');
}

function handleWrongCommand(row, command) {
  if (command === 'practice') return openPractice(row);
  if (command === 'events') return showEvents(row);
  if (command === 'hide') return hideWrongQuestion(row);
}

function openReminder(questionId) {
  const row = items.value.find((item) => item.question.id === questionId);
  if (row) openPractice(row);
}

async function showEvents(row) {
  traceTitle.value = row.question.title;
  traceEvents.value = await api(`/student/wrong-questions/${row.question.id}/events`);
  traceVisible.value = true;
}

async function hideCurrent() {
  if (!practice.value) return;
  await hideWrongQuestion(practice.value);
}

async function updateWrongQuestionStatus(row, masteryStatus) {
  await api(`/student/wrong-questions/${row.question.id}/status`, {
    method: 'PATCH',
    body: { masteryStatus },
  });
  items.value = items.value.filter((item) => item.question.id !== row.question.id);
  if (practice.value?.question.id === row.question.id) {
    practice.value = null;
    practiceVisible.value = false;
  }
  await load();
}

function emptyAnswer(question = null) {
  return {
    selectedOptionIds: [],
    blanks: blankAnswerList(question),
    text: '',
    code: '',
    language: languageOptionsFor(question)[0] || 'cc.cc17o2',
  };
}

function clearPracticeAnswer() {
  Object.assign(answer, emptyAnswer(practice.value?.question));
  practiceResult.value = null;
}

function payloadForAnswer() {
  if (answer.selectedOptionIds.filter(Boolean).length) {
    return { selectedOptionIds: answer.selectedOptionIds.filter(Boolean) };
  }
  if (answer.blanks.some((blank) => String(blank.value ?? '').trim())) {
    return { blanks: answer.blanks };
  }
  if (String(answer.text ?? '').trim()) {
    return { text: answer.text };
  }
  if (String(answer.code ?? '').trim()) {
    return {
      text: answer.code,
      extra: {
        code: answer.code,
        language: answer.language || 'cc.cc17o2',
      },
    };
  }
  return {};
}

function isSplitPracticeQuestion(type) {
  return Boolean(type) && !objectiveQuestionTypes.has(type);
}

function languageOptionsFor(question) {
  const languages = question?.programmingRef?.languages || [];
  return languages.length ? languages : ['cc.cc17o2', 'py.py3', 'java'];
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
  const url = question?.programmingRef?.externalProblemUrl;
  if (!url) {
    ElMessage.warning('该题尚未配置 Hydro 链接');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
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

function masteryLabel(value) {
  const map = {
    unmastered: '未掌握',
    reviewing: '复习中',
    mastered: '已掌握',
    ignored: '已移出',
  };
  return map[value] ?? value;
}

function sourceLabel(value) {
  const map = {
    exam: '考试',
    practice: '练习',
    manual: '手动',
    ai_recommendation: '推荐',
  };
  return map[value] ?? value;
}

function eventLabel(value) {
  const map = {
    exam_wrong: '考试错题',
    practice_wrong: '练习答错',
    practice_correct: '练习答对',
    manual_add: '手动加入',
    status_change: '状态调整',
  };
  return map[value] ?? value;
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatShortDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
}

function barWidth(value) {
  const max = Math.max(
    1,
    ...insights.masteryCurve.flatMap((item) => [item.wrong || 0, item.mastered || 0, item.manual || 0]),
  );
  return `${Math.max(8, Math.round(((value || 0) / max) * 100))}%`;
}

onMounted(async () => {
  await Promise.all([load(), loadCandidates()]);
});
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
