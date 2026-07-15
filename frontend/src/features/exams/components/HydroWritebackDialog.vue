<template>
<el-dialog v-model="hydroWritebackVisible" title="Hydro 判题回写" width="520px" destroy-on-close>
      <el-form label-width="96px">
        <el-form-item label="提交">
          <span>{{ hydroWritebackForm.externalSubmissionId || hydroWritebackForm.submissionId || '-' }}</span>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="hydroWritebackForm.status" style="width: 100%">
            <el-option label="Accepted" value="accepted" />
            <el-option label="Wrong Answer" value="wrong_answer" />
            <el-option label="Compile Error" value="compile_error" />
            <el-option label="Runtime Error" value="runtime_error" />
            <el-option label="Time Limit" value="time_limit_exceeded" />
            <el-option label="System Error" value="system_error" />
          </el-select>
        </el-form-item>
        <el-form-item label="得分">
          <el-input-number v-model="hydroWritebackForm.score" :min="0" :step="1" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="hydroWritebackForm.message" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="hydroWritebackVisible = false">取消</el-button>
        <el-button type="primary" :loading="hydroWritebackSaving" @click="submitHydroWriteback">确认回写</el-button>
      </template>
    </el-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useStatisticsPageContext } from '../composables/statisticsPageContext';

export default defineComponent({
  setup: useStatisticsPageContext,
});
</script>
