import { computed, onMounted, ref } from 'vue';
import type { FusionDashboardDto } from '../../../api/generated/models';
import { getFusionDashboard } from '../../platform/api';

const emptyDashboard: FusionDashboardDto = {
  role: 'student',
  scopeLabel: '',
  from: '',
  to: '',
  assessment: {
    exams: 0,
    submittedAttempts: 0,
    gradedAttempts: 0,
    averageScore: 0,
    pendingManual: 0,
    activeWrongQuestions: 0,
  },
  academic: {
    scheduledLessons: 0,
    completedLessons: 0,
    publishedLessonRecords: 0,
    confirmedAttendance: 0,
    attendanceRate: 0,
    absentCount: 0,
    assignedLessonHours: 0,
    consumedLessonHours: 0,
    remainingLessonHours: 0,
  },
  recentExams: [],
  teacherPerformance: [],
  drilldowns: [],
};

export function useFusionDashboard() {
  const loading = ref(false);
  const dashboard = ref<FusionDashboardDto>(structuredClone(emptyDashboard));

  const cards = computed(() => [
    { label: '考试', value: dashboard.value.assessment.exams },
    { label: '已评分', value: dashboard.value.assessment.gradedAttempts },
    { label: '平均分', value: dashboard.value.assessment.averageScore.toFixed(2) },
    { label: '待批改', value: dashboard.value.assessment.pendingManual },
    { label: '计划课次', value: dashboard.value.academic.scheduledLessons },
    { label: '已完成课次', value: dashboard.value.academic.completedLessons },
    { label: '出勤率', value: percent(dashboard.value.academic.attendanceRate) },
    { label: '剩余课时', value: dashboard.value.academic.remainingLessonHours.toFixed(2) },
  ]);

  const rangeLabel = computed(() => {
    if (!dashboard.value.from || !dashboard.value.to) return '';
    return `${date(dashboard.value.from)} 至 ${date(dashboard.value.to)}`;
  });

  async function load() {
    loading.value = true;
    try {
      dashboard.value = await getFusionDashboard();
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);
  return { loading, dashboard, cards, rangeLabel, load, percent };
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function date(value: string) {
  return new Date(value).toLocaleDateString('zh-CN');
}
