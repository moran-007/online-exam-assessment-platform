<template>
  <article class="lesson-plan-document">
    <h2 class="lesson-plan-document__title">{{ documentTitle }}</h2>
    <p class="lesson-plan-document__caption">
      {{ model.source }} · 作者：{{ model.authorName }} · 更新：{{ model.updatedAt }}
    </p>
    <table class="lesson-plan-document__table">
      <colgroup>
        <col class="lesson-plan-document__section-column">
        <col class="lesson-plan-document__label-column">
        <col class="lesson-plan-document__value-column">
        <col class="lesson-plan-document__label-column">
        <col class="lesson-plan-document__value-column">
        <col class="lesson-plan-document__label-column">
        <col class="lesson-plan-document__last-value-column">
      </colgroup>
      <tbody>
        <tr>
          <th
            :rowspan="3 + (model.learnerAnalysis ? 1 : 0)"
            class="lesson-plan-document__section"
          >
            一、基本信息
          </th>
          <th>课程名称</th>
          <td>{{ model.courseName }}</td>
          <th>课题</th>
          <td>{{ model.title }}</td>
          <th>知识点</th>
          <td>{{ model.knowledgePointName }}</td>
        </tr>
        <tr>
          <th>上课时间</th>
          <td>{{ model.scheduledAt }}</td>
          <th>上课地点</th>
          <td>{{ model.classroom }}</td>
          <th>课时</th>
          <td>{{ model.duration }}</td>
        </tr>
        <tr>
          <th>授课教师</th>
          <td>{{ model.instructorName }}</td>
          <th>教学对象</th>
          <td>{{ model.gradeLevel }}</td>
          <th>作者/上传者</th>
          <td>{{ model.authorName }}</td>
        </tr>
        <tr v-if="model.learnerAnalysis">
          <th class="lesson-plan-document__subhead">学情分析</th>
          <td colspan="5"><MarkdownRenderer :source="model.learnerAnalysis" /></td>
        </tr>
        <tr>
          <th class="lesson-plan-document__section">二、教学目标</th>
          <td colspan="6" class="lesson-plan-document__summary">
            <div v-for="item in model.objectives" :key="item.label" class="lesson-plan-document__summary-item">
              <strong>{{ item.label }}：</strong>
              <MarkdownRenderer :source="item.value" />
            </div>
          </td>
        </tr>
        <tr>
          <th class="lesson-plan-document__section">三、教学内容</th>
          <td colspan="6" class="lesson-plan-document__summary">
            <div v-for="item in model.teachingContent" :key="item.label" class="lesson-plan-document__summary-item">
              <strong>{{ item.label }}：</strong>
              <MarkdownRenderer :source="item.value" />
            </div>
          </td>
        </tr>
        <tr>
          <th class="lesson-plan-document__section">四、教学方法</th>
          <td colspan="6" class="lesson-plan-document__summary">
            <div v-for="item in model.methodsAndPreparation" :key="item.label" class="lesson-plan-document__summary-item">
              <strong>{{ item.label }}：</strong>
              <MarkdownRenderer :source="item.value" />
            </div>
          </td>
        </tr>
        <tr class="lesson-plan-document__process-row">
          <th class="lesson-plan-document__section lesson-plan-document__process-section">五、教学详细过程</th>
          <td colspan="6" class="lesson-plan-document__process-shell">
            <table
              class="lesson-plan-document__process-table"
              :class="{ 'lesson-plan-document__process-table--without-notes': !model.hasProcessNotes }"
            >
              <colgroup>
                <col class="lesson-plan-document__process-stage">
                <col class="lesson-plan-document__process-teacher">
                <col class="lesson-plan-document__process-student">
                <col v-if="model.hasProcessNotes" class="lesson-plan-document__process-note">
              </colgroup>
              <thead>
                <tr>
                  <th>教学环节</th>
                  <th>教师活动</th>
                  <th>学生活动</th>
                  <th v-if="model.hasProcessNotes">评价/意图</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in model.process" :key="item.label">
                  <th class="lesson-plan-document__stage-title">
                    <span>{{ item.label }}</span>
                  </th>
                  <td><MarkdownRenderer :source="item.teacherActivity" /></td>
                  <td><MarkdownRenderer :source="item.studentActivity" /></td>
                  <td v-if="model.hasProcessNotes">
                    <MarkdownRenderer v-if="item.designAndAssessment" :source="item.designAndAssessment" />
                  </td>
                </tr>
                <tr v-if="!model.process.length">
                  <td :colspan="model.hasProcessNotes ? 4 : 3" class="lesson-plan-document__empty">教学过程待补充</td>
                </tr>
              </tbody>
            </table>
            <div v-if="model.closing.length" class="lesson-plan-document__closing">
              <div v-for="item in model.closing" :key="item.label" class="lesson-plan-document__summary-item">
                <strong>{{ item.label }}：</strong>
                <MarkdownRenderer :source="item.value" />
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';
import {
  buildLessonPlanDocument,
  type LessonPlanDocumentContext,
} from '../composables/lessonPlanDocument';
import type { LessonPlan } from '../composables/useLessonPlanCatalog';

const props = defineProps<{
  plan: LessonPlan;
  context: LessonPlanDocumentContext;
}>();
const model = computed(() => buildLessonPlanDocument(props.plan, props.context));
const documentTitle = computed(() => model.value.title.endsWith('教案') ? model.value.title : `${model.value.title} 教案`);
</script>

<style scoped>
.lesson-plan-document {
  color: #1f2937;
  font-size: 13px;
  line-height: 1.35;
}
.lesson-plan-document__title {
  margin: 0 0 3px;
  text-align: center;
  font-size: 21px;
  line-height: 1.25;
}
.lesson-plan-document__caption {
  margin: 0 0 6px;
  color: #6b7280;
  text-align: center;
  font-size: 12px;
  line-height: 1.3;
}
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
th,
td {
  border: 1px solid #9ca3af;
  padding: 4px 6px;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
}
th {
  background: #f3f4f6;
  text-align: center;
  vertical-align: middle;
  line-height: 1.3;
}
.lesson-plan-document__section-column {
  width: 12%;
}
.lesson-plan-document__label-column {
  width: 11%;
}
.lesson-plan-document__value-column {
  width: 21%;
}
.lesson-plan-document__last-value-column {
  width: 13%;
}
.lesson-plan-document__subhead {
  font-weight: 600;
}
.lesson-plan-document__section {
  padding: 4px;
  background: #e9eef5;
  font-weight: 700;
}
.lesson-plan-document__summary {
  padding-top: 3px;
  padding-bottom: 3px;
}
.lesson-plan-document__summary-item {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px;
  align-items: start;
}
.lesson-plan-document__summary-item + .lesson-plan-document__summary-item {
  margin-top: 2px;
}
.lesson-plan-document__summary-item > strong {
  line-height: 1.35;
}
.lesson-plan-document__process-section {
  background: #dfe8f4;
}
.lesson-plan-document__process-shell {
  padding: 0;
}
.lesson-plan-document__process-table {
  width: 100%;
  border: 0;
  table-layout: fixed;
}
.lesson-plan-document__process-table th,
.lesson-plan-document__process-table td {
  border-width: 0 1px 1px 0;
  padding: 4px 5px;
}
.lesson-plan-document__process-table tr > :last-child {
  border-right: 0;
}
.lesson-plan-document__process-table tbody tr:last-child > * {
  border-bottom: 0;
}
.lesson-plan-document__process-stage {
  width: 17%;
}
.lesson-plan-document__process-teacher {
  width: 35%;
}
.lesson-plan-document__process-student {
  width: 28%;
}
.lesson-plan-document__process-note {
  width: 20%;
}
.lesson-plan-document__process-table--without-notes .lesson-plan-document__process-stage {
  width: 17%;
}
.lesson-plan-document__process-table--without-notes .lesson-plan-document__process-teacher {
  width: 45%;
}
.lesson-plan-document__process-table--without-notes .lesson-plan-document__process-student {
  width: 38%;
}
.lesson-plan-document__stage-title {
  background: #f8fafc;
}
.lesson-plan-document__stage-title span,
.lesson-plan-document__stage-title small {
  display: block;
}
.lesson-plan-document__stage-title small {
  margin-top: 1px;
  color: #64748b;
  font-size: 0.9em;
  font-weight: 500;
}
.lesson-plan-document__empty {
  padding: 8px;
  color: #94a3b8;
  text-align: center;
}
.lesson-plan-document__closing {
  padding: 4px 6px;
  border-top: 1px solid #9ca3af;
  background: #fcfcfd;
  color: #475569;
}
:deep(.markdown-body > :first-child) {
  margin-top: 0 !important;
}
:deep(.markdown-body > :last-child) {
  margin-bottom: 0 !important;
}
:deep(.markdown-body) {
  line-height: 1.35;
  overflow-x: hidden;
}
:deep(.markdown-body p) {
  margin: 0 0 2px !important;
}
:deep(.markdown-body ul),
:deep(.markdown-body ol) {
  margin: 0 !important;
  padding-left: 18px !important;
}
:deep(.markdown-body li + li) {
  margin-top: 0 !important;
}
:deep(.markdown-body pre) {
  margin: 2px 0 !important;
  padding: 4px;
  border-radius: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
:deep(.markdown-body table) {
  min-width: 0;
  margin: 2px 0 !important;
  font-size: inherit;
}
:deep(.markdown-body .katex-display),
:deep(.markdown-body figure),
:deep(.markdown-body blockquote) {
  margin: 2px 0 !important;
}
</style>
