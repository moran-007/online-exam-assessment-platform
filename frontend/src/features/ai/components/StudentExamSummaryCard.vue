<template>
  <section v-if="content" class="panel student-ai-summary">
    <div class="section-head">
      <div>
        <h2>教师发布的 AI 考试总结</h2>
        <p class="muted">已由教师人工审核 · {{ new Date(summary.publishedAt).toLocaleString() }}</p>
      </div>
      <el-tag type="success">已发布</el-tag>
    </div>
    <h3>{{ content.headline.text }}</h3>
    <div class="student-ai-sections">
      <article v-for="section in sections" :key="section.key">
        <strong>{{ section.label }}</strong>
        <ul v-if="section.claims.length">
          <li v-for="(claim, index) in section.claims" :key="`${section.key}-${index}`">{{ claim.text }}</li>
        </ul>
        <span v-else class="muted">暂无</span>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AiStructuredSummaryContent, StudentPublishedAiSummary } from '../models';

const props = defineProps<{ summary: StudentPublishedAiSummary }>();
const content = computed(() => props.summary.content as unknown as AiStructuredSummaryContent);
const sections = computed(() => [
  { key: 'overview', label: '整体概览', claims: content.value.overview },
  { key: 'strengths', label: '优势', claims: content.value.strengths },
  { key: 'risks', label: '风险与薄弱项', claims: content.value.risks },
  { key: 'actions', label: '后续建议', claims: content.value.actions },
  { key: 'needsReview', label: '需复核', claims: content.value.needsReview },
]);
</script>

<style scoped>
.student-ai-summary { margin-top: 16px; padding: 18px; }
.student-ai-summary h3 { margin: 8px 0 16px; color: var(--el-color-primary); }
.student-ai-summary p { margin: 4px 0 0; }
.student-ai-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.student-ai-sections article { padding: 14px; border-radius: 6px; background: var(--el-fill-color-light); }
.student-ai-sections ul { margin: 8px 0 0; padding-left: 20px; }
.student-ai-sections li + li { margin-top: 6px; }
@media (max-width: 760px) { .student-ai-sections { grid-template-columns: 1fr; } }
</style>
