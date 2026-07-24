<template>
  <div class="page statistics-page">
    <div class="page-head statistics-head">
      <h1 class="page-title">统计分析</h1>
      <div class="toolbar statistics-toolbar">
        <el-select v-model="filter.courseId" clearable filterable placeholder="课程" @change="loadFirstPage">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-select v-model="filter.classId" clearable filterable placeholder="班级" @change="loadFirstPage">
          <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="filter.examId" clearable filterable placeholder="考试" @change="loadFirstPage">
          <el-option v-for="exam in exams" :key="exam.id" :label="exam.name" :value="exam.id" />
        </el-select>
        <el-select v-model="filter.sourceType" clearable placeholder="错题来源" @change="loadFirstPage">
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
          @change="loadFirstPage"
        />
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button plain :icon="Setting" @click="openReviewRules">复习规则</el-button>
        <el-button type="primary" plain :icon="Download" :loading="exporting" @click="exportCurrentStatistics">
          导出当前筛选
        </el-button>
        <el-button type="success" plain :icon="DocumentAdd" :loading="generatingWrongPaper" @click="generateWrongPaper">
          高频错题组卷
        </el-button>
        <el-button type="primary" :icon="MagicStick" :disabled="!filter.examId" @click="openAiSummary()">
          AI 考试总结
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

    <div v-loading="loading" class="panel statistics-detail-panel">
      <el-tabs v-model="activeStatisticsTab" class="statistics-tabs">
        <el-tab-pane label="考试表现" name="exams">
          <div class="statistics-tab-pane">
          <div class="statistics-table-viewport">
          <el-table :data="examStats" height="100%" class="question-list-table" @row-click="loadExamDetail">
            <el-table-column prop="examName" label="考试" min-width="180" show-overflow-tooltip />
            <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="130" show-overflow-tooltip />
            <el-table-column v-if="showLowColumns" prop="className" label="班级" width="130" show-overflow-tooltip />
            <el-table-column prop="submitCount" label="提交" width="80" />
            <el-table-column prop="averageScore" label="平均分" width="100" />
            <el-table-column v-if="showMediumColumns" prop="maxScore" label="最高" width="80" />
            <el-table-column label="操作" width="126" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" plain @click.stop="openAiSummary(row)">AI 总结</el-button>
              </template>
            </el-table-column>
          </el-table>
          </div>
          <div class="table-footer statistics-table-footer">
            <span class="muted">共 {{ examPagination.total }} 场考试</span>
            <el-pagination
              v-model:current-page="examPagination.page"
              v-model:page-size="examPagination.pageSize"
              background
              size="small"
              layout="sizes, prev, pager, next"
              :page-sizes="statisticsPageSizes"
              :total="examPagination.total"
              @size-change="handleExamSizeChange"
              @current-change="handleExamCurrentChange"
            />
          </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="知识点表现" name="knowledge">
          <div class="statistics-tab-pane">
          <div class="statistics-table-viewport">
          <el-table :data="pagedKnowledgeStats" height="100%" class="question-list-table">
            <el-table-column prop="name" label="知识点" min-width="180" show-overflow-tooltip />
            <el-table-column prop="answerCount" label="作答" width="80" />
            <el-table-column prop="correctRate" label="正确率" width="100">
              <template #default="{ row }">{{ percent(row.correctRate) }}</template>
            </el-table-column>
            <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
          </el-table>
          </div>
          <StatisticsLocalPagination
            :pagination="knowledgePagination"
            label="个知识点"
            :page-sizes="statisticsPageSizes"
            @size-change="handleLocalSizeChange(knowledgePagination, $event)"
            @page-change="handleLocalCurrentChange(knowledgePagination, $event)"
          />
          </div>
        </el-tab-pane>
        <el-tab-pane label="班级概览" name="classes">
          <div class="statistics-tab-pane">
          <div class="statistics-table-viewport">
          <el-table :data="pagedClassStats" height="100%" class="question-list-table">
            <el-table-column prop="className" label="班级" min-width="160" show-overflow-tooltip />
            <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="130" show-overflow-tooltip />
            <el-table-column prop="studentCount" label="学生" width="80" />
            <el-table-column prop="submitCount" label="提交" width="80" />
            <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
          </el-table>
          </div>
          <StatisticsLocalPagination
            :pagination="classPagination"
            label="个班级"
            :page-sizes="statisticsPageSizes"
            @size-change="handleLocalSizeChange(classPagination, $event)"
            @page-change="handleLocalCurrentChange(classPagination, $event)"
          />
          </div>
        </el-tab-pane>
        <el-tab-pane label="Hydro 判题" name="hydro">
          <div class="statistics-tab-pane">
          <div class="statistics-table-viewport">
          <el-table :data="pagedHydroItems" height="100%" class="question-list-table">
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
          </div>
          <StatisticsLocalPagination
            :pagination="hydroPagination"
            label="条判题记录"
            :page-sizes="statisticsPageSizes"
            @size-change="handleLocalSizeChange(hydroPagination, $event)"
            @page-change="handleLocalCurrentChange(hydroPagination, $event)"
          />
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <div class="panel stats-question-panel statistics-question-panel">
      <div class="section-head">
        <h2>题目分析</h2>
        <span class="muted">{{ selectedExamName || '点击上方考试查看题目正确率' }}</span>
      </div>
      <div class="statistics-table-viewport">
      <el-table :data="pagedQuestionStats" height="100%" class="question-list-table">
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
      <StatisticsLocalPagination
        :pagination="questionPagination"
        label="道题目"
        :page-sizes="statisticsPageSizes"
        @size-change="handleLocalSizeChange(questionPagination, $event)"
        @page-change="handleLocalCurrentChange(questionPagination, $event)"
      />
    </div>

    <div class="panel high-wrong-panel">
      <div class="section-head">
        <h2>高频错题</h2>
        <span class="muted">按班级、课程、时间和来源聚合</span>
      </div>
      <div class="statistics-table-viewport">
      <el-table :data="pagedWrongQuestionStats" height="100%" class="question-list-table">
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
      <StatisticsLocalPagination
        :pagination="wrongQuestionPagination"
        label="道高频错题"
        :page-sizes="statisticsPageSizes"
        @size-change="handleLocalSizeChange(wrongQuestionPagination, $event)"
        @page-change="handleLocalCurrentChange(wrongQuestionPagination, $event)"
      />
    </div>

    <HydroWritebackDialog />

    <ReviewRulesDrawer />

    <ExamAiSummaryDialog ref="aiSummaryDialog" />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { MagicStick } from '@element-plus/icons-vue';
import { useStatisticsPage } from '../composables/useStatisticsPage';
import { provideStatisticsPageContext } from '../composables/statisticsPageContext';
import StatisticsMetrics from './StatisticsMetrics.vue';
import StatisticsLocalPagination from './StatisticsLocalPagination.vue';
import EChartPanel from '../../../components/EChartPanel.vue';
import HydroWritebackDialog from './HydroWritebackDialog.vue';
import ReviewRulesDrawer from './ReviewRulesDrawer.vue';
import ExamAiSummaryDialog from '../../ai/components/ExamAiSummaryDialog.vue';

export default defineComponent({
  name: 'StatisticsPage',
  components: { StatisticsMetrics, StatisticsLocalPagination, EChartPanel, HydroWritebackDialog, ReviewRulesDrawer, ExamAiSummaryDialog },
  setup() {
    const context = useStatisticsPage();
    const aiSummaryDialog = ref<InstanceType<typeof ExamAiSummaryDialog>>();
    function openAiSummary(value?: unknown) {
      const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const id = typeof row.examId === 'string' ? row.examId : context.filter.examId;
      if (!id) return;
      const option = context.exams.value.find((exam) => exam.id === id);
      const name = typeof row.examName === 'string' ? row.examName : option?.name ?? '考试';
      void aiSummaryDialog.value?.open(id, name);
    }
    provideStatisticsPageContext(context);
    return { ...context, aiSummaryDialog, MagicStick, openAiSummary };
  },
});
</script>

<style src="./StatisticsPage.css"></style>
