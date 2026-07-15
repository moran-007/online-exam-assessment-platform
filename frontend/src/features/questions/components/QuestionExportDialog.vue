<template>
<el-dialog v-model="questionExportVisible" title="题目导出设置" width="520px">
      <el-form label-width="96px">
        <el-form-item label="导出数量">
          <span>{{ pendingExportQuestionIds.length }} 道题</span>
        </el-form-item>
        <el-form-item label="导出格式">
          <el-radio-group v-model="questionExportOptions.format">
            <el-radio-button label="zip">题目压缩包</el-radio-button>
            <el-radio-button label="json">JSON</el-radio-button>
            <el-radio-button label="csv">CSV</el-radio-button>
            <el-radio-button label="xlsx">Excel</el-radio-button>
            <el-radio-button label="pdf">PDF</el-radio-button>
            <el-radio-button label="docx">Word</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="包含内容">
          <el-checkbox v-model="questionExportOptions.includeAnswers">答案</el-checkbox>
          <el-checkbox v-model="questionExportOptions.includeAnalysis">解析</el-checkbox>
        </el-form-item>
        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="ZIP、JSON、CSV 与题目导入字段保持对应；可回导必需字段：schemaVersion、title、type、difficulty、defaultScore、contentMarkdown、optionsJson、answerJson、scoringRuleJson、analysisMarkdown、tagNames、knowledgePointNames。取消答案后需补充答案再导入。"
        />
      </el-form>
      <template #footer>
        <el-button @click="questionExportVisible = false">取消</el-button>
        <el-button type="primary" :icon="Download" @click="confirmQuestionExport">生成导出</el-button>
      </template>
    </el-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useQuestionPageContext } from '../composables/questionPageContext';

export default defineComponent({
  setup: useQuestionPageContext,
});
</script>
