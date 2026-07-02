<template>
  <div class="page exam-page">
    <div class="page-head exam-head">
      <div>
        <h1 class="page-title">{{ paper?.name || '试卷试答' }}</h1>
        <span class="muted">{{ practiceSubtitle }}</span>
      </div>
      <div class="toolbar">
        <el-tag v-if="submitted" :type="resultSummaryType">
          {{ resultSummaryText }}
        </el-tag>
        <el-tag type="info">不落库</el-tag>
        <el-radio-group v-model="answerLayout" size="small" class="answer-layout-toggle">
          <el-radio-button label="side">左右</el-radio-button>
          <el-radio-button label="stack">上下</el-radio-button>
        </el-radio-group>
        <el-button
          v-if="isStudent && submitted && wrongEntries.length"
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
      <main class="exam-main">
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

            <QuestionAnswerLayout :mode="answerLayout">
              <template #statement>
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
                    <ProgrammingToolbarShell :summary="languageLabel(answers[entry.question.questionId].language)">
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
                    <CodeAnswerEditor
                      v-model="answers[entry.question.questionId].code"
                      :language="answers[entry.question.questionId].language"
                      :language-label="languageLabel(answers[entry.question.questionId].language)"
                      :rows="22"
                    />
                  </div>
                  <div v-else-if="isSplitQuestion(entry.snapshot.type)" class="programming-answer">
                    <div class="programming-toolbar">
                      <span class="programming-language-label">作答</span>
                      <el-tag>{{ typeLabel(entry.snapshot.type) }}</el-tag>
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
                      <el-tag>{{ typeLabel(entry.snapshot.type) }}</el-tag>
                    </div>
                    <el-radio-group
                      v-if="['single_choice', 'true_false'].includes(entry.snapshot.type)"
                      v-model="answers[entry.question.questionId].selectedOptionIds[0]"
                      class="answer-options"
                    >
                      <el-radio
                        v-for="option in entry.snapshot.options || []"
                        :key="optionIdFor(option)"
                        :label="optionIdFor(option)"
                        :class="['answer-option', submitted && option.isCorrect ? 'answer-correct' : '']"
                      >
                        <span class="option-choice">
                          <strong>{{ optionLabelFor(option) }}.</strong>
                          <MarkdownRenderer :source="option.content" />
                        </span>
                      </el-radio>
                    </el-radio-group>

                    <el-checkbox-group
                      v-else-if="entry.snapshot.type === 'multiple_choice'"
                      v-model="answers[entry.question.questionId].selectedOptionIds"
                      class="answer-options"
                    >
                      <el-checkbox
                        v-for="option in entry.snapshot.options || []"
                        :key="optionIdFor(option)"
                        :label="optionIdFor(option)"
                        :class="['answer-option', submitted && option.isCorrect ? 'answer-correct' : '']"
                      >
                        <span class="option-choice">
                          <strong>{{ optionLabelFor(option) }}.</strong>
                          <MarkdownRenderer :source="option.content" />
                        </span>
                      </el-checkbox>
                    </el-checkbox-group>

                    <FillBlankAnswerInputs
                      v-else-if="entry.snapshot.type === 'fill_blank'"
                      v-model="answers[entry.question.questionId].blanks"
                      :count="blankCountFor(entry.snapshot)"
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
              <el-button :icon="Delete" @click="clearAnswer(entry.question.questionId)">清除本题</el-button>
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
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowLeft, ArrowRight, Back, Check, Delete, Link, Notebook } from '@element-plus/icons-vue';
import { api, getCurrentUser } from '../api';
import CodeAnswerEditor from '../components/CodeAnswerEditor.vue';
import FillBlankAnswerInputs from '../components/FillBlankAnswerInputs.vue';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import ProgrammingToolbarShell from '../components/ProgrammingToolbarShell.vue';
import QuestionAnswerLayout from '../components/QuestionAnswerLayout.vue';

const route = useRoute();
const router = useRouter();
const paper = ref(null);
const answers = reactive({});
const submitted = ref(false);
const addingWrongQuestions = ref(false);
const currentIndex = ref(0);
const answerLayout = ref('side');
const currentUser = getCurrentUser();
const isStudent = computed(() => currentUser?.userType === 'STUDENT');
const objectiveQuestionTypes = new Set(['single_choice', 'multiple_choice', 'true_false', 'fill_blank']);
const returnPath = computed(() => {
  const explicit = Array.isArray(route.query.return) ? route.query.return[0] : route.query.return;
  return explicit || (isStudent.value ? '/student/papers' : '/papers');
});
const returnButtonText = computed(() => (isStudent.value ? '返回试卷题库' : '返回试卷'));
const practiceSubtitle = computed(() => {
  const prefix = isStudent.value ? '试卷练习' : 'trial/test 试答';
  return `${prefix} · 不计入正式成绩 · ${totalCount.value} 题 · ${paper.value?.durationMinutes ?? 0} 分钟`;
});

const displaySections = computed(() => {
  if (!paper.value) return [];
  const sections = (paper.value.sections ?? [])
    .filter((section) => section.questions?.length)
    .map((section) => ({
      title: section.title,
      questions: section.questions,
    }));
  if (paper.value.questions?.length) {
    sections.push({ title: '未分区题目', questions: paper.value.questions });
  }
  return sections;
});

const flatQuestions = computed(() => {
  let index = 0;
  return displaySections.value.flatMap((section) =>
    section.questions.map((question) => ({
      question,
      snapshot: question.questionSnapshotJson ?? {},
      sectionTitle: section.title,
      index: index++,
      result: gradeQuestion(question),
    })),
  );
});
const totalCount = computed(() => flatQuestions.value.length);
const currentEntry = computed(() => flatQuestions.value[currentIndex.value] ?? null);
const visibleEntries = computed(() => (currentEntry.value ? [currentEntry.value] : []));
const answeredCount = computed(() => flatQuestions.value.filter((entry) => isAnswered(entry.question.questionId)).length);
const progressPercent = computed(() => (totalCount.value ? Math.round((answeredCount.value / totalCount.value) * 100) : 0));
const correctCount = computed(() => submitted.value ? flatQuestions.value.filter((entry) => entry.result?.isCorrect).length : 0);
const pendingReviewCount = computed(() => (
  submitted.value ? flatQuestions.value.filter((entry) => entry.result?.isCorrect === null).length : 0
));
const autoCheckedCount = computed(() => Math.max(0, totalCount.value - pendingReviewCount.value));
const allCorrect = computed(() => totalCount.value > 0 && pendingReviewCount.value === 0 && correctCount.value === totalCount.value);
const resultSummaryType = computed(() => (pendingReviewCount.value ? 'warning' : allCorrect.value ? 'success' : 'danger'));
const resultSummaryText = computed(() => {
  if (!submitted.value) return '';
  if (pendingReviewCount.value) {
    return `${correctCount.value} / ${autoCheckedCount.value} 自动判对，${pendingReviewCount.value} 题待自评`;
  }
  return `${correctCount.value} / ${totalCount.value} 正确`;
});
const wrongEntries = computed(() => (
  submitted.value
    ? flatQuestions.value.filter((entry) => entry.result?.isCorrect === false && entry.question.questionId)
    : []
));

async function load() {
  paper.value = await api(isStudent.value ? `/student/papers/${route.params.paperId}/preview` : `/papers/${route.params.paperId}/preview`);
  resetAnswers();
}

function resetAnswers() {
  Object.keys(answers).forEach((key) => delete answers[key]);
  for (const entry of flatQuestions.value) {
    answers[entry.question.questionId] = emptyAnswer(entry.snapshot);
  }
  currentIndex.value = Math.min(currentIndex.value, Math.max(totalCount.value - 1, 0));
}

function emptyAnswer(snapshot = null) {
  return {
    selectedOptionIds: [],
    blanks: blankAnswerList(snapshot),
    text: '',
    code: '',
    language: languageOptionsFor(snapshot)[0] || 'cc.cc17o2',
  };
}

function clearAll() {
  resetAnswers();
  currentIndex.value = 0;
  submitted.value = false;
}

function clearAnswer(questionId) {
  if (!answers[questionId]) return;
  const snapshot = flatQuestions.value.find((entry) => entry.question.questionId === questionId)?.snapshot;
  Object.assign(answers[questionId], emptyAnswer(snapshot));
  submitted.value = false;
}

function submit() {
  submitted.value = true;
}

async function addWrongQuestionsToBook() {
  const questionIds = wrongEntries.value.map((entry) => entry.question.questionId).filter(Boolean);
  if (!questionIds.length) {
    ElMessage.warning('当前没有可加入错题本的题目');
    return;
  }

  addingWrongQuestions.value = true;
  try {
    const result = await api('/student/wrong-questions/batch', {
      method: 'POST',
      body: { items: questionIds.map((questionId) => ({ questionId })) },
    });
    const failedText = result.failed?.length ? `，${result.failed.length} 道失败` : '';
    ElMessage.success(`已加入 ${result.successCount} 道错题${failedText}`);
  } catch (error) {
    ElMessage.error(error.message || '加入错题本失败');
  } finally {
    addingWrongQuestions.value = false;
  }
}

function isAnswered(questionId) {
  const answer = answers[questionId];
  if (!answer) return false;
  return Boolean(
    answer.selectedOptionIds?.filter(Boolean).length
      || answer.blanks?.some((blank) => String(blank.value ?? '').trim())
      || String(answer.code ?? '').trim()
      || String(answer.text ?? '').trim(),
  );
}

function gradeQuestion(paperQuestion) {
  const snapshot = paperQuestion.questionSnapshotJson ?? {};
  const answer = answers[paperQuestion.questionId] ?? emptyAnswer(snapshot);
  if (['single_choice', 'multiple_choice', 'true_false'].includes(snapshot.type)) {
    const selected = new Set(answer.selectedOptionIds?.filter(Boolean) ?? []);
    const correct = new Set((snapshot.options ?? []).filter((option) => option.isCorrect).map((option) => optionIdFor(option)));
    const isCorrect = selected.size === correct.size && [...selected].every((optionId) => correct.has(optionId));
    return { isCorrect };
  }
  if (snapshot.type === 'fill_blank') {
    const rules = snapshot.answer?.blanks ?? [];
    if (!rules.length) return { isCorrect: null };
    const isCorrect = rules.every((rule) => {
      const submittedValue = answer.blanks?.find((blank) => Number(blank.index) === Number(rule.index))?.value ?? '';
      const normalized = rule.ignoreCase ? submittedValue.trim().toLowerCase() : submittedValue.trim();
      return (rule.answers ?? []).some((item) => (rule.ignoreCase ? item.trim().toLowerCase() : item.trim()) === normalized);
    });
    return { isCorrect };
  }
  return { isCorrect: null };
}

function resultTagType(result) {
  if (result?.isCorrect === true) return 'success';
  if (result?.isCorrect === false) return 'danger';
  return 'warning';
}

function resultLabel(result) {
  if (result?.isCorrect === true) return '正确';
  if (result?.isCorrect === false) return '错误';
  return '待自评';
}

function numberTitle(entry) {
  const status = isAnswered(entry.question.questionId) ? '已答' : '未答';
  const result = submitted.value ? `，${resultLabel(entry.result)}` : '';
  return `第 ${entry.index + 1} 题：${status}${result}`;
}

function goQuestion(index) {
  if (index < 0 || index >= totalCount.value) return;
  currentIndex.value = index;
}

function isSplitQuestion(type) {
  return !objectiveQuestionTypes.has(type);
}

function languageOptionsFor(snapshot) {
  const languages = snapshot?.programmingRef?.languages || [];
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

function openHydroProblem(snapshot) {
  const url = snapshot?.programmingRef?.externalProblemUrl;
  if (!url) {
    ElMessage.warning('该题尚未配置 Hydro 链接');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function optionIdFor(option) {
  return option?.id ?? option?.optionId ?? option?.optionKey ?? '';
}

function optionLabelFor(option) {
  return option?.optionKey ?? option?.label ?? optionIdFor(option);
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

function blankCountFor(snapshot) {
  const answerBlanks = snapshot?.answer?.blanks;
  if (Array.isArray(answerBlanks) && answerBlanks.length) return answerBlanks.length;
  return Math.max(1, countBlankMarkers(snapshot?.content));
}

function blankAnswerList(snapshot, existing = []) {
  const source = Array.isArray(existing) ? existing : [];
  const count = Math.max(blankCountFor(snapshot), ...source.map((blank) => Number(blank?.index) || 0), 1);
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

onMounted(load);
</script>
