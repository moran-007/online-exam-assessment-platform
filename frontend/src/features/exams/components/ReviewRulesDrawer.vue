<template>
<el-drawer v-model="reviewRulesVisible" title="错题复习提醒规则" size="720px" class="review-rule-drawer">
      <div class="review-rule-body">
        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="规则可按课程、班级、知识点叠加；命中多条时优先使用知识点，其次班级，最后课程。"
        />
        <section class="review-rule-editor">
          <div class="section-head">
            <h2>{{ reviewRuleForm.id ? '编辑规则' : '新增规则' }}</h2>
            <el-button size="small" @click="resetReviewRuleForm">清空</el-button>
          </div>
          <el-form label-width="98px" class="review-rule-form">
            <el-form-item label="课程范围">
              <el-select
                v-model="reviewRuleForm.courseId"
                clearable
                filterable
                placeholder="全部课程"
                style="width: 100%"
                @change="handleReviewRuleCourseChange"
              >
                <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="班级范围">
              <el-select v-model="reviewRuleForm.classId" clearable filterable placeholder="全部班级" style="width: 100%">
                <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="知识点">
              <el-tree-select
                v-model="reviewRuleForm.knowledgePointId"
                :data="reviewKnowledgeTreeOptions"
                check-strictly
                clearable
                filterable
                :disabled="!reviewRuleForm.courseId"
                placeholder="不限知识点"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="规则模板">
              <el-segmented v-model="reviewRuleForm.preset" :options="reviewPresetOptions" @change="applyReviewPreset" />
            </el-form-item>
            <el-form-item label="间隔天数">
              <el-input v-model="reviewRuleForm.intervalsText" placeholder="例如：1,3,7,14,30" />
            </el-form-item>
            <el-form-item label="掌握规则" class="review-rule-wide">
              <div class="review-mastery-grid">
                <div class="review-mastery-item">
                  <el-input-number v-model="reviewRuleForm.correctStreak" :min="1" :max="20" />
                  <span class="muted">连续答对次数</span>
                </div>
                <div class="review-mastery-item">
                  <el-input-number v-model="reviewRuleForm.reviewingIntervalDays" :min="1" :max="365" />
                  <span class="muted">掌握前复习间隔</span>
                </div>
              </div>
            </el-form-item>
            <el-form-item label="启用">
              <el-switch v-model="reviewRuleForm.enabled" />
            </el-form-item>
            <el-form-item label="操作">
              <div class="toolbar">
                <el-button type="primary" :loading="reviewRuleSaving" @click="saveReviewRule">保存规则</el-button>
                <el-button @click="resetReviewRuleForm">重置</el-button>
              </div>
            </el-form-item>
          </el-form>
        </section>
        <section class="review-rule-list">
          <div class="section-head">
            <h2>已有规则</h2>
            <el-button :icon="Refresh" :loading="reviewRulesLoading" @click="loadReviewRules">刷新</el-button>
          </div>
          <el-table :data="reviewRules" height="100%" class="question-list-table compact-table">
            <el-table-column label="范围" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ reviewRuleScope(row) }}</template>
            </el-table-column>
            <el-table-column label="间隔" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ (row.intervalsDays || []).join(' / ') }} 天</template>
            </el-table-column>
            <el-table-column label="掌握" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                连续 {{ row.masteryRule?.correctStreak || 3 }} 次，{{ row.masteryRule?.reviewingIntervalDays || 3 }} 天复习
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <div class="question-actions">
                  <el-button size="small" @click="editReviewRule(row)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="deleteReviewRule(row)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </div>
    </el-drawer>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useStatisticsPageContext } from '../composables/statisticsPageContext';

export default defineComponent({
  setup: useStatisticsPageContext,
});
</script>
