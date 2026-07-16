<template>
  <div class="page academic-operations-page">
    <section class="page-head">
      <div>
        <h2 class="page-title">教学运营</h2>
        <p class="muted">排课、考勤与课时共用同一套可追溯数据；余额始终由不可变台账重算。</p>
      </div>
      <div class="toolbar">
        <el-select v-if="classes.length" v-model="selectedClassId" clearable placeholder="全部班级" style="width: 190px" @change="load">
          <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" @change="load" />
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>
    </section>

    <el-alert
      title="Gate D 已启用：考勤确认与课时扣减同事务提交；重复确认不会重复扣款，更正只追加冲正台账。"
      type="success"
      :closable="false"
      show-icon
    />

    <section class="panel operations-panel">
      <el-tabs v-model="activeTab" class="page-tabs">
        <el-tab-pane label="排课日历" name="calendar">
          <div class="tab-toolbar">
            <span class="muted">当前范围共 {{ sessions.length }} 节课</span>
            <div v-if="canManageSchedule">
              <el-button data-testid="create-session" @click="openSession">新增临时课</el-button>
              <el-button data-testid="generate-sessions" type="primary" @click="openGenerate">批量生成课次</el-button>
            </div>
          </div>
          <el-table v-loading="loading" :data="sessions" height="calc(100% - 52px)" data-testid="session-table">
            <el-table-column label="日期时间" min-width="190">
              <template #default="{ row }"><strong>{{ formatTime(row.startsAt) }}</strong><div class="muted">至 {{ formatClock(row.endsAt) }}</div></template>
            </el-table-column>
            <el-table-column prop="classGroup.name" label="班级" min-width="150" />
            <el-table-column label="课次" min-width="220"><template #default="{ row }"><strong>{{ row.title }}</strong><div class="muted">{{ row.lessonType.name }} · {{ row.lessonHours }} 课时</div></template></el-table-column>
            <el-table-column label="教师 / 教室" min-width="170"><template #default="{ row }">{{ row.teacher?.realName || row.teacher?.username || '待安排' }}<div class="muted">{{ row.classroom || '未设置教室' }}</div></template></el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="sessionStatusType(row.status)">{{ sessionStatus(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="考勤" width="100" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openAttendanceRow(row)">打开考勤</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="考勤确认" name="attendance">
          <div class="tab-toolbar">
            <el-select v-model="selectedSessionId" filterable placeholder="选择课次" style="width: 420px" @change="loadAttendance">
              <el-option v-for="item in sessions" :key="item.id" :label="`${formatTime(item.startsAt)} · ${item.classGroup.name} · ${item.title}`" :value="item.id" />
            </el-select>
            <el-button v-if="canConfirmAttendance" data-testid="confirm-attendance" type="primary" :loading="saving" :disabled="!attendance" @click="submitAttendance">批量确认并扣课时</el-button>
          </div>
          <el-empty v-if="!attendance" description="请选择一个课次开始考勤" />
          <template v-else>
            <el-descriptions :column="4" border class="attendance-summary">
              <el-descriptions-item label="班级">{{ attendance.session.className }}</el-descriptions-item>
              <el-descriptions-item label="课型">{{ attendance.session.lessonTypeName }}</el-descriptions-item>
              <el-descriptions-item label="时间">{{ formatTime(attendance.session.startsAt) }}</el-descriptions-item>
              <el-descriptions-item label="默认扣减">{{ attendance.session.lessonHours }} 课时</el-descriptions-item>
            </el-descriptions>
            <el-table :data="attendance.records" height="calc(100% - 116px)" data-testid="attendance-table">
              <el-table-column prop="studentName" label="学生" min-width="160" />
              <el-table-column label="考勤状态" min-width="180">
                <template #default="{ row }">
                  <el-select v-if="!row.confirmedAt && canConfirmAttendance" v-model="row.draftStatus" style="width: 150px">
                    <el-option v-for="item in attendanceOptions" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                  <el-tag v-else>{{ attendanceStatus(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="扣减课时" width="160">
                <template #default="{ row }"><el-input-number v-if="!row.confirmedAt && canConfirmAttendance" v-model="row.draftDeductHours" :min="0" :step="0.5" /><span v-else>{{ row.deductHours }}</span></template>
              </el-table-column>
              <el-table-column label="确认状态" min-width="180"><template #default="{ row }"><span v-if="row.confirmedAt">{{ formatTime(row.confirmedAt) }} · v{{ row.version }}</span><span v-else class="muted">待确认</span></template></el-table-column>
              <el-table-column label="历史" width="100"><template #default="{ row }"><el-tag v-if="row.legacyBaseline" type="info">迁移基线</el-tag><span v-else>{{ row.revisionCount }} 次更正</span></template></el-table-column>
              <el-table-column v-if="canCorrectAttendance" label="操作" width="100" fixed="right"><template #default="{ row }"><el-button v-if="row.confirmedAt" link type="warning" @click="openCorrectionRow(row)">更正</el-button></template></el-table-column>
            </el-table>
          </template>
        </el-tab-pane>

        <el-tab-pane label="课时台账" name="ledger">
          <div class="tab-toolbar">
            <span class="muted">余额 = 全部台账金额之和，不保存可漂移的独立余额。</span>
            <div><el-button v-if="canReconcile" data-testid="reconcile-hours" @click="runReconciliation">全量重算核对</el-button><el-button v-if="canAdjustHours" type="primary" @click="openAdjustment()">登记课时变动</el-button></div>
          </div>
          <el-alert v-if="reconciliation" :title="reconciliation.passed ? `核对通过：${reconciliation.items.length} 名学生差异为 0` : '核对未通过，请检查差异记录'" :type="reconciliation.passed ? 'success' : 'error'" :closable="false" show-icon />
          <div class="ledger-grid">
            <el-table :data="balances" height="100%" data-testid="balance-table">
              <el-table-column prop="studentName" label="学生" min-width="150" />
              <el-table-column label="当前余额" width="120"><template #default="{ row }"><strong>{{ row.balance }}</strong></template></el-table-column>
              <el-table-column prop="entryCount" label="台账笔数" width="100" />
              <el-table-column v-if="canAdjustHours" label="操作" width="90"><template #default="{ row }"><el-button link type="primary" @click="openAdjustmentRow(row)">变动</el-button></template></el-table-column>
            </el-table>
            <el-table :data="ledger" height="100%" data-testid="ledger-table">
              <el-table-column label="时间" width="170"><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></el-table-column>
              <el-table-column prop="studentName" label="学生" min-width="130" />
              <el-table-column label="类型" width="120"><template #default="{ row }">{{ ledgerType(row.type) }}</template></el-table-column>
              <el-table-column label="变动" width="90"><template #default="{ row }"><span :class="row.amount > 0 ? 'credit' : 'debit'">{{ row.amount > 0 ? '+' : '' }}{{ row.amount }}</span></template></el-table-column>
              <el-table-column prop="note" label="说明" min-width="190" />
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane v-if="canManageSchedule" label="排课规则" name="rules">
          <div class="tab-toolbar"><span class="muted">规则按本地星期与时区生成，生成键保证重复执行不新增重复课次。</span><el-button type="primary" @click="openRule">新增规则</el-button></div>
          <el-table :data="rules" height="calc(100% - 52px)">
            <el-table-column prop="classGroup.name" label="班级" min-width="150" />
            <el-table-column label="星期 / 时间" min-width="170"><template #default="{ row }">周{{ weekday(row.weekday) }} · {{ minuteText(row.startMinute) }}-{{ minuteText(row.endMinute) }}</template></el-table-column>
            <el-table-column prop="lessonType.name" label="课型" min-width="130" />
            <el-table-column prop="unitTemplate.name" label="课程单元" min-width="180"><template #default="{ row }">{{ row.unitTemplate?.name || '-' }}</template></el-table-column>
            <el-table-column label="有效期" min-width="210"><template #default="{ row }">{{ dateText(row.effectiveFrom) }} 至 {{ row.effectiveTo ? dateText(row.effectiveTo) : '长期' }}</template></el-table-column>
            <el-table-column prop="status" label="状态" width="100" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane v-if="canManageCatalog" label="课型与课程单元" name="catalog">
          <div class="catalog-grid">
            <div class="catalog-section"><div class="tab-toolbar"><strong>课型</strong><el-button type="primary" @click="openLessonType">新增课型</el-button></div><el-table :data="lessonTypes" height="calc(100% - 52px)"><el-table-column prop="name" label="名称" /><el-table-column prop="defaultHours" label="默认课时" width="100" /><el-table-column label="计入统计" width="100"><template #default="{ row }"><el-tag :type="row.countInStatistics ? 'success' : 'info'">{{ row.countInStatistics ? '是' : '否' }}</el-tag></template></el-table-column></el-table></div>
            <div class="catalog-section"><div class="tab-toolbar"><strong>课程单元模板</strong><el-button type="primary" @click="openUnit">新增单元</el-button></div><el-table :data="units" height="calc(100% - 52px)"><el-table-column prop="code" label="编码" min-width="130" /><el-table-column prop="name" label="名称" min-width="180" /><el-table-column prop="lessonTypeName" label="课型" width="120" /><el-table-column prop="defaultHours" label="课时" width="80" /></el-table></div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="ruleVisible" title="新增排课规则" width="680px" destroy-on-close>
      <el-form :model="ruleForm" label-width="96px">
        <el-form-item label="班级"><el-select v-model="ruleForm.classId" style="width:100%"><el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="课型"><el-select v-model="ruleForm.lessonTypeId" style="width:100%"><el-option v-for="item in lessonTypes" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="课程单元"><el-select v-model="ruleForm.unitTemplateId" clearable style="width:100%"><el-option v-for="item in units" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <div class="form-row"><el-form-item label="星期"><el-select v-model="ruleForm.weekday"><el-option v-for="index in 7" :key="index - 1" :label="`周${weekday(index - 1)}`" :value="index - 1" /></el-select></el-form-item><el-form-item label="开始"><el-time-select v-model="ruleForm.startTime" start="06:00" step="00:15" end="23:45" /></el-form-item><el-form-item label="结束"><el-time-select v-model="ruleForm.endTime" start="06:15" step="00:15" end="24:00" /></el-form-item></div>
        <div class="form-row"><el-form-item label="生效日期"><el-date-picker v-model="ruleForm.effectiveFrom" value-format="YYYY-MM-DD" /></el-form-item><el-form-item label="结束日期"><el-date-picker v-model="ruleForm.effectiveTo" value-format="YYYY-MM-DD" /></el-form-item></div>
        <div class="form-row"><el-form-item label="扣减课时"><el-input-number v-model="ruleForm.lessonHours" :min="0" :step="0.5" /></el-form-item><el-form-item label="教室"><el-input v-model="ruleForm.classroom" /></el-form-item></div>
      </el-form><template #footer><el-button @click="ruleVisible=false">取消</el-button><el-button type="primary" @click="submitRule">保存规则</el-button></template>
    </el-dialog>

    <el-dialog v-model="generateVisible" title="批量生成课次" width="560px" destroy-on-close>
      <el-form :model="generateForm" label-width="90px"><el-form-item label="指定规则"><el-select v-model="generateForm.ruleId" clearable style="width:100%"><el-option v-for="item in rules" :key="item.id" :label="`${item.classGroup.name} · 周${weekday(item.weekday)} ${minuteText(item.startMinute)}`" :value="item.id" /></el-select></el-form-item><el-form-item label="班级"><el-select v-model="generateForm.classId" clearable style="width:100%"><el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><el-form-item label="日期范围"><el-date-picker v-model="generateForm.from" value-format="YYYY-MM-DD" /><span class="range-separator">至</span><el-date-picker v-model="generateForm.to" value-format="YYYY-MM-DD" /></el-form-item></el-form><template #footer><el-button @click="generateVisible=false">取消</el-button><el-button data-testid="submit-generate" type="primary" @click="submitGenerate">生成课次</el-button></template>
    </el-dialog>

    <el-dialog v-model="sessionVisible" title="新增临时课次" width="640px" destroy-on-close>
      <el-form :model="sessionForm" label-width="90px"><el-form-item label="班级"><el-select v-model="sessionForm.classId" style="width:100%"><el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><el-form-item label="课型"><el-select v-model="sessionForm.lessonTypeId" style="width:100%"><el-option v-for="item in lessonTypes" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><el-form-item label="课程单元"><el-select v-model="sessionForm.unitTemplateId" clearable style="width:100%"><el-option v-for="item in units" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><el-form-item label="标题"><el-input v-model="sessionForm.title" /></el-form-item><div class="form-row"><el-form-item label="开始"><el-date-picker v-model="sessionForm.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item><el-form-item label="结束"><el-date-picker v-model="sessionForm.endsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item></div><div class="form-row"><el-form-item label="课时"><el-input-number v-model="sessionForm.lessonHours" :min="0" :step="0.5" /></el-form-item><el-form-item label="教室"><el-input v-model="sessionForm.classroom" /></el-form-item></div></el-form><template #footer><el-button @click="sessionVisible=false">取消</el-button><el-button type="primary" @click="submitSession">保存课次</el-button></template>
    </el-dialog>

    <el-dialog v-model="correctionVisible" title="更正考勤" width="520px" destroy-on-close><el-form :model="correctionForm" label-width="90px"><el-form-item label="状态"><el-select v-model="correctionForm.status" style="width:100%"><el-option v-for="item in attendanceOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="扣减课时"><el-input-number v-model="correctionForm.deductHours" :min="0" :step="0.5" /></el-form-item><el-form-item label="更正原因"><el-input v-model="correctionForm.reason" type="textarea" :rows="3" /></el-form-item></el-form><template #footer><el-button @click="correctionVisible=false">取消</el-button><el-button data-testid="submit-correction" type="warning" @click="submitCorrection">追加冲正并更正</el-button></template></el-dialog>

    <el-dialog v-model="adjustmentVisible" title="登记课时变动" width="540px" destroy-on-close><el-form :model="adjustmentForm" label-width="90px"><el-form-item label="学生"><el-select v-model="adjustmentForm.studentId" filterable style="width:100%"><el-option v-for="item in balances" :key="item.studentId" :label="`${item.studentName}（余额 ${item.balance}）`" :value="item.studentId" /></el-select></el-form-item><el-form-item label="类型"><el-select v-model="adjustmentForm.type" style="width:100%"><el-option label="购买" value="PURCHASE" /><el-option label="赠送" value="GIFT" /><el-option label="退款" value="REFUND" /><el-option label="人工调整" value="MANUAL_ADJUSTMENT" /></el-select></el-form-item><el-form-item label="课时数量"><el-input-number v-model="adjustmentForm.amount" :step="0.5" /></el-form-item><el-form-item label="说明"><el-input v-model="adjustmentForm.note" /></el-form-item></el-form><template #footer><el-button @click="adjustmentVisible=false">取消</el-button><el-button type="primary" @click="submitAdjustment">写入台账</el-button></template></el-dialog>

    <el-dialog v-model="lessonTypeVisible" title="新增课型" width="520px" destroy-on-close><el-form :model="lessonTypeForm" label-width="100px"><el-form-item label="名称"><el-input v-model="lessonTypeForm.name" /></el-form-item><el-form-item label="默认课时"><el-input-number v-model="lessonTypeForm.defaultHours" :min="0" :step="0.5" /></el-form-item><el-form-item label="计入统计"><el-switch v-model="lessonTypeForm.countInStatistics" /></el-form-item><el-form-item label="说明"><el-input v-model="lessonTypeForm.description" type="textarea" /></el-form-item></el-form><template #footer><el-button @click="lessonTypeVisible=false">取消</el-button><el-button type="primary" @click="submitLessonType">保存课型</el-button></template></el-dialog>

    <el-dialog v-model="unitVisible" title="新增课程单元" width="620px" destroy-on-close><el-form :model="unitForm" label-width="100px"><el-form-item label="编码"><el-input v-model="unitForm.code" /></el-form-item><el-form-item label="名称"><el-input v-model="unitForm.name" /></el-form-item><el-form-item label="课型"><el-select v-model="unitForm.lessonTypeId" style="width:100%"><el-option v-for="item in lessonTypes" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item><div class="form-row"><el-form-item label="分类"><el-input v-model="unitForm.category" /></el-form-item><el-form-item label="阶段"><el-input v-model="unitForm.stage" /></el-form-item></div><div class="form-row"><el-form-item label="序号"><el-input-number v-model="unitForm.unitNo" :min="0" /></el-form-item><el-form-item label="默认课时"><el-input-number v-model="unitForm.defaultHours" :min="0" :step="0.5" /></el-form-item></div><el-form-item label="教学内容"><el-input v-model="unitForm.teachingContent" type="textarea" :rows="3" /></el-form-item></el-form><template #footer><el-button @click="unitVisible=false">取消</el-button><el-button type="primary" @click="submitUnit">保存单元</el-button></template></el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue';
import type { AcademicOperationRecord } from '../api';
import { useAcademicOperations } from '../composables/useAcademicOperations';

const attendanceOptions = [
  { label: '待确认', value: 'UNCONFIRMED' }, { label: '出勤', value: 'PRESENT' },
  { label: '迟到', value: 'LATE' }, { label: '早退', value: 'EARLY_LEAVE' },
  { label: '请假', value: 'LEAVE' }, { label: '缺勤', value: 'ABSENT' }, { label: '补签', value: 'MAKEUP' },
];

const {
  activeTab, adjustmentForm, adjustmentVisible, attendance, balances, canAdjustHours,
  canConfirmAttendance, canCorrectAttendance, canManageCatalog, canManageSchedule, canReconcile,
  classes, correctionForm, correctionVisible, dateRange, generateForm, generateVisible, ledger,
  lessonTypeForm, lessonTypeVisible, lessonTypes, loading, openAdjustment, openAttendance,
  openCorrection, openGenerate, openLessonType, openRule, openSession, openUnit, reconciliation,
  ruleForm, ruleVisible, rules, saving, selectedClassId, selectedSessionId, sessionForm,
  sessionVisible, sessions, submitAdjustment, submitAttendance, submitCorrection, submitGenerate,
  submitLessonType, submitRule, submitSession, submitUnit, unitForm, unitVisible, units, load,
  loadAttendance, runReconciliation,
} = useAcademicOperations();

const openAttendanceRow = (row: unknown) => openAttendance(row as AcademicOperationRecord);
const openCorrectionRow = (row: unknown) => openCorrection(row as AcademicOperationRecord);
const openAdjustmentRow = (row: unknown) => openAdjustment(row as AcademicOperationRecord);

const sessionStatus = (value: string) => ({ PLANNED: '待上课', COMPLETED: '已完成', CANCELLED: '已取消', RESCHEDULED: '已调课' }[value] || value);
const sessionStatusType = (value: string): 'success' | 'warning' | 'danger' | 'info' => ({ COMPLETED: 'success', CANCELLED: 'danger', RESCHEDULED: 'warning' }[value] || 'info') as 'success' | 'warning' | 'danger' | 'info';
const attendanceStatus = (value: string) => attendanceOptions.find((item) => item.value === value)?.label || value;
const ledgerType = (value: string) => ({ OPENING_BALANCE: '期初余额', PURCHASE: '购买', GIFT: '赠送', CONSUME: '考勤扣减', REVERSAL: '冲正', REFUND: '退款', TRANSFER_IN: '转入', TRANSFER_OUT: '转出', MANUAL_ADJUSTMENT: '人工调整' }[value] || value);
const formatTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const formatClock = (value: string) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
const dateText = (value: string) => String(value || '').slice(0, 10);
const weekday = (value: number) => ['日', '一', '二', '三', '四', '五', '六'][value] || '-';
const minuteText = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
</script>

<style scoped>
.academic-operations-page { min-height: 0; }
.operations-panel { flex: 1; min-height: 0; overflow: hidden; }
.operations-panel :deep(.el-tabs) { height: 100%; display: flex; flex-direction: column; }
.operations-panel :deep(.el-tabs__content), .operations-panel :deep(.el-tab-pane) { flex: 1; min-height: 0; }
.tab-toolbar { min-height: 44px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.attendance-summary { margin-bottom: 14px; }
.ledger-grid, .catalog-grid { height: calc(100% - 52px); display: grid; grid-template-columns: minmax(360px, 0.8fr) minmax(560px, 1.4fr); gap: 16px; }
.catalog-grid { grid-template-columns: minmax(380px, 0.8fr) minmax(560px, 1.2fr); }
.catalog-section { min-height: 0; overflow: hidden; }
.form-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.form-row:has(.el-form-item:nth-child(3)) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.credit { color: var(--el-color-success); font-weight: 700; }
.debit { color: var(--el-color-danger); font-weight: 700; }
.range-separator { margin: 0 8px; color: var(--el-text-color-secondary); }
@media (max-width: 1100px) { .ledger-grid, .catalog-grid { grid-template-columns: 1fr; height: auto; } .ledger-grid > *, .catalog-grid > * { height: 440px; } }
</style>
