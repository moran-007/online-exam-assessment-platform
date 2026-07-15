<template>
  <div class="page statistics-page">
    <div class="page-head statistics-head">
      <h1 class="page-title">统计分析</h1>
      <div class="toolbar statistics-toolbar">
        <el-select v-model="filter.courseId" clearable filterable placeholder="课程" @change="load">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-select v-model="filter.classId" clearable filterable placeholder="班级" @change="load">
          <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="filter.examId" clearable filterable placeholder="考试" @change="load">
          <el-option v-for="exam in exams" :key="exam.id" :label="exam.name" :value="exam.id" />
        </el-select>
        <el-select v-model="filter.sourceType" clearable placeholder="错题来源" @change="load">
          <el-option label="考试错题" value="exam" />
          <el-option label="练习错题" value="practice" />
          <el-option label="手动加入" value="manual" />
        </el-select>
        <el-date-picker
          v-model="filter.dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          value-format="YYYY-MM-DD"
          @change="load"
        />
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button plain :icon="Setting" @click="openReviewRules">复习规则</el-button>
        <el-button type="primary" plain :icon="Download" :loading="exporting" @click="exportCurrentStatistics">
          导出当前筛选
        </el-button>
        <el-button type="success" plain :icon="DocumentAdd" :loading="generatingWrongPaper" @click="generateWrongPaper">
          高频错题组卷
        </el-button>
      </div>
    </div>

    <StatisticsMetrics :overview="overview" :hydro-summary="hydroSummary" />

    <div class="statistics-insight-grid">
      <div class="panel statistics-card">
        <div class="section-head">
          <h2>成绩分布</h2>
          <span class="muted">共 {{ scoreDistribution.total || 0 }} 次提交</span>
        </div>
        <EChartPanel :option="scoreDistributionOption" height="100%" />
      </div>

      <div class="panel statistics-card">
        <div class="section-head">
          <h2>班级对比</h2>
          <span class="muted">通过率 / 完成率</span>
        </div>
        <EChartPanel :option="classComparisonOption" height="100%" />
      </div>

      <div class="panel statistics-card">
        <div class="section-head">
          <h2>知识点趋势</h2>
          <span class="muted">按日期聚合</span>
        </div>
        <EChartPanel :option="knowledgeTrendOption" height="100%" />
      </div>

      <div class="panel statistics-card statistics-diagnostic-card">
        <div class="section-head">
          <h2>题目诊断</h2>
          <span class="muted">区分度、难度回归与异常识别</span>
        </div>
        <EChartPanel :option="questionDiagnosticsOption" height="180px" />
        <el-table :data="questionDiagnostics" height="calc(100% - 190px)" class="question-list-table compact-table">
          <el-table-column prop="title" label="题目" min-width="220" show-overflow-tooltip />
          <el-table-column prop="correctRate" label="正确率" width="88">
            <template #default="{ row }">{{ percent(row.correctRate) }}</template>
          </el-table-column>
          <el-table-column prop="discrimination" label="区分度" width="88">
            <template #default="{ row }">{{ formatNumber(row.discrimination) }}</template>
          </el-table-column>
          <el-table-column prop="difficultyDelta" label="难度偏差" width="96">
            <template #default="{ row }">{{ signed(row.difficultyDelta) }}</template>
          </el-table-column>
          <el-table-column prop="anomalyCount" label="异常" width="76" />
          <el-table-column v-if="showMediumColumns" prop="suggestion" label="建议" min-width="220" show-overflow-tooltip />
        </el-table>
      </div>
    </div>

    <div class="panel library-table-panel statistics-detail-panel">
      <el-tabs class="statistics-tabs">
        <el-tab-pane label="考试表现">
          <el-table :data="examStats" height="100%" class="question-list-table" @row-click="loadExamDetail">
            <el-table-column prop="examName" label="考试" min-width="180" show-overflow-tooltip />
            <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="130" show-overflow-tooltip />
            <el-table-column v-if="showLowColumns" prop="className" label="班级" width="130" show-overflow-tooltip />
            <el-table-column prop="submitCount" label="提交" width="80" />
            <el-table-column prop="averageScore" label="平均分" width="100" />
            <el-table-column v-if="showMediumColumns" prop="maxScore" label="最高" width="80" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="知识点表现">
          <el-table :data="knowledgeStats" height="100%" class="question-list-table">
            <el-table-column prop="name" label="知识点" min-width="180" show-overflow-tooltip />
            <el-table-column prop="answerCount" label="作答" width="80" />
            <el-table-column prop="correctRate" label="正确率" width="100">
              <template #default="{ row }">{{ percent(row.correctRate) }}</template>
            </el-table-column>
            <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="班级概览">
          <el-table :data="classStats" height="100%" class="question-list-table">
            <el-table-column prop="className" label="班级" min-width="160" show-overflow-tooltip />
            <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="130" show-overflow-tooltip />
            <el-table-column prop="studentCount" label="学生" width="80" />
            <el-table-column prop="submitCount" label="提交" width="80" />
            <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="Hydro 判题">
          <el-table :data="hydroSummary.items || []" height="100%" class="question-list-table">
            <el-table-column prop="examName" label="考试" min-width="150" show-overflow-tooltip />
            <el-table-column prop="studentName" label="学生" width="120" show-overflow-tooltip />
            <el-table-column prop="questionTitle" label="题目" min-width="180" show-overflow-tooltip />
            <el-table-column prop="externalProblemId" label="Hydro" width="100" />
            <el-table-column prop="score" label="得分" width="80" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'judge_done' ? 'success' : 'warning'">
                  {{ hydroStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="showMediumColumns" label="最近提交" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.latestSubmission?.externalSubmissionId || row.latestSubmission?.submissionId || '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="96">
              <template #default="{ row }">
                <el-button size="small" :disabled="!row.latestSubmission" @click="openHydroWriteback(row)">回写</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <div class="panel library-table-panel stats-question-panel statistics-question-panel">
      <div class="section-head">
        <h2>题目分析</h2>
        <span class="muted">{{ selectedExamName || '点击上方考试查看题目正确率' }}</span>
      </div>
      <el-table :data="questionStats" height="100%" class="question-list-table">
        <el-table-column prop="title" label="题目" min-width="260" show-overflow-tooltip />
        <el-table-column prop="type" label="题型" width="120" />
        <el-table-column v-if="showMediumColumns" prop="difficulty" label="难度" width="90" />
        <el-table-column prop="answerCount" label="作答" width="90" />
        <el-table-column prop="correctRate" label="正确率" width="100">
          <template #default="{ row }">{{ percent(row.correctRate) }}</template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
      </el-table>
    </div>

    <div class="panel library-table-panel high-wrong-panel">
      <div class="section-head">
        <h2>高频错题</h2>
        <span class="muted">按班级、课程、时间和来源聚合</span>
      </div>
      <el-table :data="wrongQuestionStats" height="100%" class="question-list-table">
        <el-table-column prop="title" label="题目" min-width="260" show-overflow-tooltip />
        <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="140" show-overflow-tooltip />
        <el-table-column v-if="showMediumColumns" label="知识点" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ (row.knowledgePointNames || []).join('、') || '-' }}</template>
        </el-table-column>
        <el-table-column prop="wrongCount" label="错误频次" width="100" />
        <el-table-column prop="studentCount" label="涉及学生" width="100" />
        <el-table-column v-if="showMediumColumns" label="来源" min-width="160">
          <template #default="{ row }">
            <el-tag
              v-for="source in row.sourceSummary || []"
              :key="source.source"
              size="small"
              effect="plain"
              class="source-chip"
            >
              {{ sourceLabel(source.source) }} {{ source.count }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="showLowColumns" label="最近记录" width="160">
          <template #default="{ row }">{{ formatDate(row.latestAt) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <HydroWritebackDialog />

    <ReviewRulesDrawer />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useStatisticsPage } from '../composables/useStatisticsPage';
import { provideStatisticsPageContext } from '../composables/statisticsPageContext';
import StatisticsMetrics from './StatisticsMetrics.vue';
import EChartPanel from '../../../components/EChartPanel.vue';
import HydroWritebackDialog from './HydroWritebackDialog.vue';
import ReviewRulesDrawer from './ReviewRulesDrawer.vue';

export default defineComponent({
  name: 'StatisticsPage',
  components: { StatisticsMetrics, EChartPanel, HydroWritebackDialog, ReviewRulesDrawer },
  setup() {
    const context = useStatisticsPage();
    provideStatisticsPageContext(context);
    return context;
  },
});
</script>

<style>
.statistics-page {
  --statistics-panel-height: clamp(250px, 30vh, 340px);
}

.statistics-head {
  align-items: flex-start;
}

.statistics-toolbar {
  flex: 1 1 680px;
  justify-content: flex-end;
}

.statistics-toolbar > .el-select {
  flex: 0 1 220px;
}

.statistics-toolbar :deep(.el-date-editor) {
  flex: 0 1 280px;
  min-width: 220px;
}

.statistics-metric-row {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.statistics-insight-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  flex: 0 0 clamp(230px, 28vh, 330px);
  min-height: 230px;
}

.statistics-card {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.statistics-diagnostic-card {
  grid-column: span 1;
}

.compact-table :deep(.el-table__cell) {
  padding: 7px 0;
}

.statistics-detail-panel {
  flex: 0 0 var(--statistics-panel-height);
  min-height: 0;
  height: var(--statistics-panel-height);
}

.statistics-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.statistics-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
}

.statistics-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.statistics-detail-panel :deep(.el-table__empty-block) {
  min-height: 140px;
}

.statistics-question-panel {
  flex: 1 1 260px;
  min-height: 260px;
}

.high-wrong-panel {
  flex: 1 1 300px;
  min-height: 300px;
}

.source-chip {
  margin-right: 6px;
  margin-bottom: 4px;
}

.review-rule-drawer :deep(.el-drawer__body) {
  min-height: 0;
  overflow: hidden;
}

.review-rule-body {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(260px, 1fr);
  gap: 14px;
}

.review-rule-editor,
.review-rule-list {
  min-width: 0;
}

.review-rule-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.review-rule-form .review-rule-wide,
.review-rule-form .el-form-item:nth-last-child(-n + 2) {
  grid-column: 1 / -1;
}

.review-mastery-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 10px 16px;
  align-items: center;
}

.review-mastery-item {
  min-width: 0;
  display: flex;
  gap: 10px;
  align-items: center;
}

.review-mastery-item :deep(.el-input-number) {
  flex: 0 0 120px;
  width: 120px;
}

.review-mastery-item .muted {
  min-width: 0;
  line-height: 1.4;
  white-space: normal;
}

.review-rule-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.review-rule-list > .el-table {
  flex: 1;
  min-height: 0;
}

@media (max-width: 1500px) {
  .statistics-insight-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    flex-basis: 520px;
  }

  .statistics-detail-panel {
    height: 300px;
  }

  .high-wrong-panel {
    min-height: 280px;
  }
}

@media (max-width: 980px) {
  .statistics-insight-grid {
    grid-template-columns: 1fr;
    flex: 0 0 auto;
  }

  .statistics-card {
    height: 280px;
  }

  .statistics-detail-panel {
    height: 300px;
  }

  .statistics-toolbar :deep(.el-date-editor),
  .statistics-toolbar > .el-select {
    flex: 1 1 100%;
  }
}

@media (max-width: 760px) {
  .review-rule-form {
    grid-template-columns: 1fr;
  }

  .review-mastery-grid {
    grid-template-columns: 1fr;
  }
}
</style>
