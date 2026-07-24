import { reactive, ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  adjustHours,
  createLessonType,
  updateLessonType,
  type AcademicOperationRecord,
} from '../api';
import { compact } from './academicOperationsHelpers';

export function useAcademicOperationCatalog(
  selectedClassId: Ref<string>,
  reload: () => Promise<void>,
  reloadHours: () => Promise<void>,
) {
  const lessonTypeVisible = ref(false);
  const lessonTypeEditingId = ref('');
  const adjustmentVisible = ref(false);
  const lessonTypeForm = reactive({
    name: '', defaultHours: 1, countInStatistics: true, active: true, description: '',
  });
  const adjustmentForm = reactive({ studentId: '', type: 'PURCHASE', amount: 1, note: '' });

  function openLessonType(row?: AcademicOperationRecord) {
    lessonTypeEditingId.value = row?.id ?? '';
    Object.assign(lessonTypeForm, row ? {
      name: row.name,
      defaultHours: row.defaultHours,
      countInStatistics: row.countInStatistics,
      active: row.active,
      description: row.description ?? '',
    } : { name: '', defaultHours: 1, countInStatistics: true, active: true, description: '' });
    lessonTypeVisible.value = true;
  }

  async function submitLessonType() {
    const body = {
      ...lessonTypeForm,
      name: lessonTypeForm.name.trim(),
      description: compact(lessonTypeForm.description),
    };
    if (lessonTypeEditingId.value) await updateLessonType(lessonTypeEditingId.value, body);
    else await createLessonType(body);
    lessonTypeVisible.value = false;
    ElMessage.success(lessonTypeEditingId.value ? '课型已更新' : '课型已创建');
    await reload();
  }

  function openAdjustment(row?: AcademicOperationRecord) {
    Object.assign(adjustmentForm, {
      studentId: row?.studentId ?? '', type: 'PURCHASE', amount: 1, note: '',
    });
    adjustmentVisible.value = true;
  }

  async function submitAdjustment() {
    if (!adjustmentForm.studentId) {
      ElMessage.warning('请选择学生');
      return;
    }
    await adjustHours({
      studentId: adjustmentForm.studentId,
      classId: selectedClassId.value || undefined,
      type: adjustmentForm.type,
      amount: Number(adjustmentForm.amount),
      idempotencyKey: `ui:${crypto.randomUUID()}`,
      note: compact(adjustmentForm.note),
    });
    adjustmentVisible.value = false;
    ElMessage.success('课时变动已记入不可变台账');
    await reloadHours();
  }

  return {
    adjustmentForm, adjustmentVisible, lessonTypeEditingId, lessonTypeForm, lessonTypeVisible,
    openAdjustment, openLessonType, submitAdjustment, submitLessonType,
  };
}
