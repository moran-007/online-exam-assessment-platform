<template>
  <div class="page exam-page">
    <div class="page-head exam-head">
      <div>
        <h1 class="page-title">{{ paper?.name || '试卷试答' }}</h1>
        <span class="muted">trial/test 试答 · 不计入正式成绩 · {{ totalCount }} 题 · {{ paper?.durationMinutes }} 分钟</span>
      </div>
      <div class="toolbar">
        <el-tag v-if="submitted" :type="allCorrect ? 'success' : 'danger'">
          {{ correctCount }} / {{ totalCount }} 正确
        </el-tag>
        <el-tag type="info">不落库</el-tag>
        <el-button :icon="Back" @click="router.push(returnPath)">返回试卷</el-button>
        <el-button :icon="Delete" @click="clearAll">清空</el-button>
        <el-button type="primary" :icon="Check" @click="submit">检查答案</el-button>
      </div>
    </div>

    <div class="exam-layout">
      <main class="exam-main">
        <section
          v-for="entry in flatQuestions"
          :key="entry.question.questionId"
          :data-question-id="entry.question.questionId"
          class="question-card exam-question"
        >
          <div class="question-title">
            <div>
              <span>第 {{ entry.index + 1 }} 题</span>
              <span class="muted">{{ entry.sectionTitle }}</span>
            </div>
            <div class="toolbar">
              <el-tag>{{ entry.question.score }} 分</el-tag>
              <el-tag v-if="submitted" :type="entry.result?.isCorrect ? 'success' : 'danger'">
                {{ entry.result?.isCorrect ? '正确' : '错误' }}
              </el-tag>
            </div>
          </div>

          <h2 class="exam-question-title">{{ entry.snapshot.title }}</h2>
          <MarkdownRenderer :source="entry.snapshot.content" />

          <el-radio-group
            v-if="['single_choice', 'true_false'].includes(entry.snapshot.type)"
            v-model="answers[entry.question.questionId].selectedOptionIds[0]"
            class="answer-options"
          >
            <el-radio
              v-for="option in entry.snapshot.options || []"
              :key="option.id"
              :label="option.id"
              :class="['answer-option', submitted && option.isCorrect ? 'answer-correct' : '']"
            >
              <span class="option-choice">
                <strong>{{ option.optionKey }}.</strong>
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
              :key="option.id"
              :label="option.id"
              :class="['answer-option', submitted && option.isCorrect ? 'answer-correct' : '']"
            >
              <span class="option-choice">
                <strong>{{ option.optionKey }}.</strong>
                <MarkdownRenderer :source="option.content" />
              </span>
            </el-checkbox>
          </el-checkbox-group>

          <el-input v-else-if="entry.snapshot.type === 'fill_blank'" v-model="answers[entry.question.questionId].blanks[0].value" />
          <el-input v-else v-model="answers[entry.question.questionId].text" type="textarea" :rows="5" />

          <div v-if="submitted" class="paper-analysis">
            <strong>解析</strong>
            <MarkdownRenderer :source="entry.snapshot.analysis || '暂无解析'" />
          </div>
        </section>
      </main>

      <aside class="exam-aside panel">
        <div class="exam-progress">
          <div class="exam-progress-head">
            <strong>试答结果</strong>
            <span>{{ correctCount }} / {{ totalCount }}</span>
          </div>
          <el-progress :percentage="totalCount ? Math.round((correctCount / totalCount) * 100) : 0" :show-text="false" />
        </div>
        <div class="question-number-grid">
          <button
            v-for="entry in flatQuestions"
            :key="entry.question.questionId"
            type="button"
            :class="{
              'question-nav-item': true,
              answered: isAnswered(entry.question.questionId),
              unanswered: !isAnswered(entry.question.questionId),
              flagged: submitted && !entry.result?.isCorrect,
            }"
            @click="scrollTo(entry.question.questionId)"
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
import { Back, Check, Delete } from '@element-plus/icons-vue';
import { api, getCurrentUser } from '../api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';

const route = useRoute();
const router = useRouter();
const paper = ref(null);
const answers = reactive({});
const submitted = ref(false);
const currentUser = getCurrentUser();
const isStudent = computed(() => currentUser?.userType === 'STUDENT');
const returnPath = computed(() => (isStudent.value ? '/student/wrong-questions' : '/papers'));

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
const correctCount = computed(() => submitted.value ? flatQuestions.value.filter((entry) => entry.result?.isCorrect).length : 0);
const allCorrect = computed(() => totalCount.value > 0 && correctCount.value === totalCount.value);

async function load() {
  paper.value = await api(isStudent.value ? `/student/papers/${route.params.paperId}/preview` : `/papers/${route.params.paperId}/preview`);
  resetAnswers();
}

function resetAnswers() {
  Object.keys(answers).forEach((key) => delete answers[key]);
  for (const entry of flatQuestions.value) {
    answers[entry.question.questionId] = emptyAnswer();
  }
}

function emptyAnswer() {
  return {
    selectedOptionIds: [],
    blanks: [{ index: 1, value: '' }],
    text: '',
  };
}

function clearAll() {
  resetAnswers();
  submitted.value = false;
}

function submit() {
  submitted.value = true;
}

function isAnswered(questionId) {
  const answer = answers[questionId];
  if (!answer) return false;
  return Boolean(answer.selectedOptionIds?.filter(Boolean).length || answer.blanks?.some((blank) => String(blank.value ?? '').trim()) || String(answer.text ?? '').trim());
}

function gradeQuestion(paperQuestion) {
  const snapshot = paperQuestion.questionSnapshotJson ?? {};
  const answer = answers[paperQuestion.questionId] ?? emptyAnswer();
  if (['single_choice', 'multiple_choice', 'true_false'].includes(snapshot.type)) {
    const selected = new Set(answer.selectedOptionIds?.filter(Boolean) ?? []);
    const correct = new Set((snapshot.options ?? []).filter((option) => option.isCorrect).map((option) => option.id));
    const isCorrect = selected.size === correct.size && [...selected].every((optionId) => correct.has(optionId));
    return { isCorrect };
  }
  if (snapshot.type === 'fill_blank') {
    const rules = snapshot.answer?.blanks ?? [];
    const isCorrect = rules.every((rule) => {
      const submittedValue = answer.blanks?.find((blank) => blank.index === rule.index)?.value ?? '';
      const normalized = rule.ignoreCase ? submittedValue.trim().toLowerCase() : submittedValue.trim();
      return (rule.answers ?? []).some((item) => (rule.ignoreCase ? item.trim().toLowerCase() : item.trim()) === normalized);
    });
    return { isCorrect };
  }
  return { isCorrect: false };
}

function scrollTo(questionId) {
  document.querySelector(`[data-question-id="${questionId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

onMounted(load);
</script>
