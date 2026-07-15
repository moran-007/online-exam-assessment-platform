import { computed, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getAnnouncementReads, remindAnnouncementUnread } from '../api';
import type { AnnouncementReadReport, ManagedExam } from '../models';

type AnnouncementContext = {
  exams: Ref<ManagedExam[]>;
  selectedExam: Ref<ManagedExam | null>;
  normalizeExam: (value: unknown) => ManagedExam;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function useExamAnnouncements({ exams, selectedExam, normalizeExam }: AnnouncementContext) {
  const announcementReadsVisible = ref(false);
  const announcementReadReport = ref<AnnouncementReadReport | null>(null);
  const announcementReadsLoading = ref(false);
  const announcementRemindLoading = ref(false);
  const announcementUnreadOnly = ref(false);
  const announcementUnreadItems = computed(() =>
    (announcementReadReport.value?.items ?? []).filter((item) => !item.read),
  );
  const announcementReadItems = computed(() =>
    announcementUnreadOnly.value ? announcementUnreadItems.value : announcementReadReport.value?.items ?? [],
  );

  async function openAnnouncementReads(value: unknown = selectedExam.value || exams.value[0]) {
    if (!value) {
      ElMessage.warning('请先选择考试');
      return;
    }
    const row = normalizeExam(value);
    selectedExam.value = row;
    announcementReadsLoading.value = true;
    try {
      announcementReadReport.value = await getAnnouncementReads(row.id);
      announcementUnreadOnly.value = false;
      announcementReadsVisible.value = true;
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '公告阅读统计加载失败'));
    } finally {
      announcementReadsLoading.value = false;
    }
  }

  async function sendAnnouncementReminder() {
    if (!announcementReadReport.value?.examId) return;
    try {
      await ElMessageBox.confirm(
        `将给 ${announcementUnreadItems.value.length} 名未读学生生成站内提醒，是否继续？`,
        '发送公告阅读提醒',
        { type: 'warning', confirmButtonText: '发送提醒', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
    announcementRemindLoading.value = true;
    try {
      const result = await remindAnnouncementUnread(announcementReadReport.value.examId);
      ElMessage.success(`已生成 ${result.createdCount} 条提醒，跳过 ${result.skippedCount} 条已有提醒`);
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '发送提醒失败'));
    } finally {
      announcementRemindLoading.value = false;
    }
  }

  function exportAnnouncementUnreadCsv() {
    const rows = announcementUnreadItems.value;
    if (!rows.length) {
      ElMessage.warning('当前没有未读学生');
      return;
    }
    const lines = [
      ['学生', '账号', '是否进入考试', '是否提交', '考试'],
      ...rows.map((row) => [
        row.realName || row.username,
        row.username,
        row.entered ? '已进入' : '未进入',
        row.submitted ? '已提交' : '未提交',
        announcementReadReport.value?.examName || '',
      ]),
    ].map((line) => line.map(csvCell).join(','));
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${announcementReadReport.value?.examName || '考试公告'}-未读名单.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return {
    announcementReadItems,
    announcementReadReport,
    announcementReadsLoading,
    announcementReadsVisible,
    announcementRemindLoading,
    announcementUnreadItems,
    announcementUnreadOnly,
    exportAnnouncementUnreadCsv,
    openAnnouncementReads,
    sendAnnouncementReminder,
  };
}
