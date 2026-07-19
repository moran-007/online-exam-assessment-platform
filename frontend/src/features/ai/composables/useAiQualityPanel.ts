import { onMounted, reactive, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getCurrentUser } from '../../../api';
import type { CreateAiRegressionRunDto } from '../../../api/generated/models';
import type {
  AiFeedbackRecord,
  AiProviderConfig,
  AiQualityDashboard,
  AiRegressionRun,
} from '../models';
import {
  getAiQualityDashboard,
  listAiFeedback,
  listAiRegressions,
  resolveAiFeedback,
  runAiRegression,
} from '../api';

export function useAiQualityPanel(configurations: Ref<AiProviderConfig[]>) {
  const user = getCurrentUser();
  const permissions = new Set(user?.permissions ?? []);
  const canRead = user?.userType === 'SUPER_ADMIN' || permissions.has('ai.quality.read');
  const canManage = user?.userType === 'SUPER_ADMIN' || permissions.has('ai.quality.manage');
  const loading = ref(false);
  const running = ref(false);
  const dashboard = ref<AiQualityDashboard | null>(null);
  const feedback = ref<AiFeedbackRecord[]>([]);
  const regressions = ref<AiRegressionRun[]>([]);
  const regressionForm = reactive<CreateAiRegressionRunDto>({ configId: '', summaryType: 'exam', caseCount: 2 });

  async function load() {
    if (!canRead) return;
    loading.value = true;
    try {
      const [quality, feedbackPage, runs] = await Promise.all([
        getAiQualityDashboard(), listAiFeedback({ pageSize: 20 }), listAiRegressions(),
      ]);
      dashboard.value = quality;
      feedback.value = feedbackPage.items;
      regressions.value = runs;
    } finally {
      loading.value = false;
    }
  }

  async function runRegression() {
    if (!regressionForm.configId) return void ElMessage.warning('请选择候选模型配置');
    await ElMessageBox.confirm(
      `将调用候选模型验证 ${regressionForm.caseCount} 个真实成功样本，并产生 Token 用量。是否继续？`,
      '执行模型切换回归',
      { type: 'warning' },
    );
    running.value = true;
    try {
      const result = await runAiRegression({
        configId: regressionForm.configId,
        summaryType: regressionForm.summaryType,
        caseCount: regressionForm.caseCount,
      });
      const resultMessage = `回归完成：${result.passedCases}/${result.totalCases} 通过`;
      if (result.status === 'passed') ElMessage.success(resultMessage);
      else ElMessage.error(resultMessage);
      await load();
    } finally {
      running.value = false;
    }
  }

  async function resolve(record: unknown, status: 'resolved' | 'dismissed') {
    const row = record as AiFeedbackRecord;
    const { value: resolutionNote } = await ElMessageBox.prompt('请输入事实核对结果或处置说明', status === 'resolved' ? '解决反馈' : '驳回反馈', {
      inputValidator: (text) => Boolean(String(text).trim()) || '处置说明不能为空',
    });
    await resolveAiFeedback(row.id, { status, resolutionNote: resolutionNote.trim() });
    ElMessage.success('反馈已处置并写入审计记录');
    await load();
  }

  onMounted(load);
  return {
    canManage, canRead, configurations, dashboard, feedback, load, loading,
    regressionForm, regressions, resolve, runRegression, running,
  };
}
