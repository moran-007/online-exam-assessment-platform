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
            <el-dropdown trigger="click" @command="(command) => handleWrongCommand(row, command)" @click.stop>
              <el-button size="small">操作</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="practice">作答</el-dropdown-item>
                  <el-dropdown-item command="hide">移出</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="practiceVisible" title="错题练习" width="780px">
      <template v-if="practice">
        <div class="paper-preview-head">
          <div>
            <h2>{{ practice.question.title }}</h2>
            <span class="muted">{{ typeLabel(practice.question.type) }} · {{ practice.question.defaultScore }} 分</span>
          </div>
          <el-tag type="warning">个人错题</el-tag>
        </div>
        <MarkdownRenderer :source="practice.question.content" />

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

        <el-input v-else-if="practice.question.type === 'fill_blank'" v-model="answer.blanks[0].value" class="answer-input" placeholder="填写答案" />
        <el-input v-else v-model="answer.text" class="answer-input" type="textarea" :rows="5" placeholder="填写答案" />

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
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Aim, Check, Delete, Document, Download, Hide, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import AnswerFeedback from '../components/AnswerFeedback.vue';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
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
const exportVisible = ref(false);
const answer = reactive(emptyAnswer());
const exportForm = reactive({
  format: 'pdf',
  includeAnswers: true,
  includeAnalysis: true,
  includeWrongInfo: true,
});

async function load() {
  items.value = await api('/student/wrong-questions');
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
  router.push(`/papers/${result.paperId}/answer`);
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
  ElMessage.success('错题导出已生成');
  if (task.fileUrl) window.open(task.fileUrl, '_blank');
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
  practiceResult.value = await api(`/questions/${practice.value.question.id}/check-answer`, {
    method: 'POST',
    body: payloadForAnswer(),
  });
  if (practiceResult.value?.isCorrect) {
    await updateWrongQuestionStatus(practice.value, 'mastered');
    ElMessage.success('回答正确，已自动从错题本隐藏');
  }
}

async function hideWrongQuestion(row) {
  await updateWrongQuestionStatus(row, 'ignored');
  ElMessage.success('已移出错题本');
}

function handleWrongCommand(row, command) {
  if (command === 'practice') return openPractice(row);
  if (command === 'hide') return hideWrongQuestion(row);
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
}

function emptyAnswer() {
  return {
    selectedOptionIds: [],
    blanks: [{ index: 1, value: '' }],
    text: '',
  };
}

function clearPracticeAnswer() {
  Object.assign(answer, emptyAnswer());
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
  return {};
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

onMounted(async () => {
  await Promise.all([load(), loadCandidates()]);
});
</script>
