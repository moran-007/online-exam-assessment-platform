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
        <el-tab-pane v-if="canReadSchedule" label="排课日历" name="calendar">
          <div class="tab-toolbar">
            <span class="muted">当前范围共 {{ sessions.length }} 节课</span>
            <div v-if="canManageSchedule">
              <el-button @click="classroomManagerVisible = true">教室管理</el-button>
              <el-button data-testid="create-session" @click="openSession">单次排课</el-button>
              <el-button data-testid="generate-sessions" type="primary" @click="openGenerate">顺序排课</el-button>
            </div>
          </div>
          <ScheduleCalendar
            v-loading="loading"
            :sessions="sessions"
            :can-manage-lesson-records="canManageLessonRecords"
            :can-read-attendance="canReadAttendance"
            :can-manage-schedule="canManageSchedule"
            @record="openLessonRecord"
            @attendance="openAttendance"
            @cancel="cancelScheduledSession"
            @change="openSessionChange"
          />
        </el-tab-pane>

        <el-tab-pane v-if="canReadAttendance" label="考勤确认" name="attendance">
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
                  <el-select v-if="!row.confirmedAt && canConfirmAttendance" v-model="row.draftStatus" style="width: 150px" @change="normalizeAttendanceDeductRow(row)">
                    <el-option v-for="item in attendanceOptions" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                  <el-tag v-else>{{ attendanceStatus(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="扣减课时" width="160">
                <template #default="{ row }"><el-input-number v-if="!row.confirmedAt && canConfirmAttendance" v-model="row.draftDeductHours" :min="0" :step="0.5" :disabled="!canDeductForStatus(row.draftStatus)" /><span v-else>{{ row.deductHours }}</span></template>
              </el-table-column>
              <el-table-column label="确认状态" min-width="180"><template #default="{ row }"><span v-if="row.confirmedAt">{{ formatTime(row.confirmedAt) }} · v{{ row.version }}</span><span v-else class="muted">待确认</span></template></el-table-column>
              <el-table-column label="历史" width="100"><template #default="{ row }"><el-tag v-if="row.legacyBaseline" type="info">迁移基线</el-tag><span v-else>{{ row.revisionCount }} 次更正</span></template></el-table-column>
              <el-table-column v-if="canCorrectAttendance" label="操作" width="100" fixed="right"><template #default="{ row }"><el-button v-if="row.confirmedAt" link type="warning" @click="openCorrectionRow(row)">更正</el-button></template></el-table-column>
            </el-table>
          </template>
        </el-tab-pane>

        <el-tab-pane v-if="canReadLessonHours" label="课时台账" name="ledger">
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

        <el-tab-pane v-if="canReadSchedule" label="排课规则" name="rules">
          <div class="tab-toolbar"><span class="muted">规则按本地星期与时区生成，生成键保证重复执行不新增重复课次。</span><el-button v-if="canManageSchedule" data-testid="create-rule" type="primary" @click="openRule()">新增规则</el-button></div>
          <el-table :data="rules" height="calc(100% - 52px)" data-testid="schedule-rule-table">
            <el-table-column prop="classGroup.name" label="班级" min-width="150" />
            <el-table-column label="课程" min-width="150"><template #default="{ row }">{{ row.classGroup.course?.name || '未关联' }}</template></el-table-column>
            <el-table-column label="教师" min-width="130"><template #default="{ row }">{{ row.teacher?.realName || row.teacher?.username || '未设置' }}</template></el-table-column>
            <el-table-column label="星期 / 时间" min-width="170"><template #default="{ row }">周{{ weekday(row.weekday) }} · {{ minuteText(row.startMinute) }}-{{ minuteText(row.endMinute) }}</template></el-table-column>
            <el-table-column prop="lessonType.name" label="课型" min-width="130" />
            <el-table-column label="有效期" min-width="210"><template #default="{ row }">{{ dateText(row.effectiveFrom) }} 至 {{ row.effectiveTo ? dateText(row.effectiveTo) : '长期' }}</template></el-table-column>
            <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="catalogStatusType(row.status)">{{ catalogStatus(row.status) }}</el-tag></template></el-table-column>
            <el-table-column v-if="canManageSchedule" label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" aria-label="编辑排课规则" @click="openRuleRow(row)">编辑</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane v-if="canReadCatalog" label="课型设置" name="catalog">
          <div v-if="canReadLessonTypes" class="catalog-section">
            <div class="tab-toolbar"><span class="muted">课型用于设置常规课、补课等上课方式；课程进度请在课程知识点中维护。</span><el-button v-if="canManageLessonTypes" data-testid="create-lesson-type" type="primary" @click="openLessonType()">新增课型</el-button></div>
            <el-table :data="lessonTypes" height="calc(100% - 52px)" data-testid="lesson-type-table"><el-table-column prop="name" label="名称" /><el-table-column prop="defaultHours" label="默认课时" width="120" /><el-table-column label="计入统计" width="110"><template #default="{ row }">{{ row.countInStatistics ? '是' : '否' }}</template></el-table-column><el-table-column prop="description" label="说明" min-width="220" /><el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.active ? 'success' : 'info'">{{ row.active ? '启用' : '停用' }}</el-tag></template></el-table-column><el-table-column v-if="canManageLessonTypes" label="操作" width="80"><template #default="{ row }"><el-button link type="primary" aria-label="编辑课型" @click="openLessonTypeRow(row)">编辑</el-button></template></el-table-column></el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="ruleVisible" :title="ruleEditingId ? '编辑排课规则' : '新增排课规则'" width="680px" destroy-on-close>
      <el-form :model="ruleForm" label-width="96px">
        <el-alert title="规则仅预设班级、教师、课型和上课时间；具体知识点在顺序排课时选择。" type="info" :closable="false" class="dialog-tip" />
        <el-form-item label="班级"><el-select v-model="ruleForm.classId" style="width:100%" @change="onRuleClassChange"><el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="课程"><el-input :model-value="scheduleCourse?.name || '班级未关联课程'" disabled /></el-form-item>
        <el-form-item label="默认教师"><el-select v-model="ruleForm.teacherId" style="width:100%" placeholder="选择该班任课教师"><el-option v-for="item in scheduleTeachers" :key="item.id" :label="item.realName || item.username" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="上课类型"><el-select v-model="ruleForm.lessonTypeId" style="width:100%" @change="onRuleLessonTypeChange"><el-option v-for="item in lessonTypes.filter(type => type.active || type.id === ruleForm.lessonTypeId)" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <div class="form-row"><el-form-item label="星期"><el-select v-model="ruleForm.weekday"><el-option v-for="index in 7" :key="index - 1" :label="`周${weekday(index - 1)}`" :value="index - 1" /></el-select></el-form-item><el-form-item label="开始"><el-time-select v-model="ruleForm.startTime" start="06:00" step="00:15" end="23:45" /></el-form-item><el-form-item label="结束"><el-time-select v-model="ruleForm.endTime" start="06:15" step="00:15" end="24:00" /></el-form-item></div>
        <div class="form-row"><el-form-item label="生效日期"><el-date-picker v-model="ruleForm.effectiveFrom" value-format="YYYY-MM-DD" /></el-form-item><el-form-item label="结束日期"><el-date-picker v-model="ruleForm.effectiveTo" value-format="YYYY-MM-DD" /></el-form-item></div>
        <div class="form-row"><el-form-item label="扣减课时"><el-input-number v-model="ruleForm.lessonHours" :min="0" :step="0.5" /></el-form-item><el-form-item label="教室"><el-select v-model="ruleForm.classroom" allow-create filterable clearable style="width:100%" placeholder="选择或输入教室"><el-option v-for="item in classroomOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></div>
        <el-form-item label="规则状态"><el-select v-model="ruleForm.status" style="width:100%"><el-option label="启用" value="ACTIVE" /><el-option label="暂停" value="PAUSED" /><el-option label="归档" value="ARCHIVED" /></el-select></el-form-item>
      </el-form><template #footer><el-button @click="ruleVisible=false">取消</el-button><el-button type="primary" @click="submitRule">保存规则</el-button></template>
    </el-dialog>

    <el-dialog v-model="generateVisible" title="顺序排课" width="680px" destroy-on-close>
      <el-form :model="generateForm" label-width="104px">
        <el-form-item label="排课规则"><el-select v-model="generateForm.ruleId" style="width:100%" placeholder="选择已预设规则" @change="onGenerateRuleChange"><el-option v-for="item in rules.filter(rule => rule.status === 'ACTIVE')" :key="item.id" :label="`${item.classGroup.name} · ${item.teacher?.realName || item.teacher?.username || '待安排'} · 周${weekday(item.weekday)} ${minuteText(item.startMinute)}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="课程"><el-input :model-value="scheduleCourse?.name || '班级未关联课程'" disabled /></el-form-item>
        <el-form-item label="起始知识点"><el-select v-model="generateForm.startKnowledgePointId" filterable style="width:100%" placeholder="选择第 1 节课内容" @change="onGenerateKnowledgeChange"><el-option v-for="item in scheduleKnowledgePoints" :key="item.id" :label="`${item.sequence}. ${item.name}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="课次数"><el-input-number v-model="generateForm.sessionCount" :min="1" :max="generateRemainingCount" /></el-form-item>
        <el-form-item label="排课预览"><div class="sequence-preview"><span v-for="(item, index) in generatePreview" :key="item.id"><el-tag>{{ index + 1 }}</el-tag>{{ item.name }}</span><span v-if="!generatePreview.length" class="muted">请先选择规则和知识点</span></div></el-form-item>
        <el-form-item label="日期范围"><el-date-picker v-model="generateForm.from" value-format="YYYY-MM-DD" /><span class="range-separator">至</span><el-date-picker v-model="generateForm.to" value-format="YYYY-MM-DD" /></el-form-item>
      </el-form><template #footer><el-button @click="generateVisible=false">取消</el-button><el-button data-testid="submit-generate" type="primary" @click="submitGenerate">按顺序生成</el-button></template>
    </el-dialog>

    <el-dialog v-model="sessionVisible" title="单次排课" width="680px" destroy-on-close>
      <el-form :model="sessionForm" label-width="96px">
        <el-form-item label="班级"><el-select v-model="sessionForm.classId" style="width:100%" @change="onSessionClassChange"><el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="课程"><el-input :model-value="scheduleCourse?.name || '班级未关联课程'" disabled /></el-form-item>
        <el-form-item label="教师"><el-select v-model="sessionForm.teacherId" style="width:100%"><el-option v-for="item in scheduleTeachers" :key="item.id" :label="item.realName || item.username" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="上课类型"><el-select v-model="sessionForm.lessonTypeId" style="width:100%" @change="onSessionLessonTypeChange"><el-option v-for="item in lessonTypes.filter(type => type.active)" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="课程知识点"><el-select v-model="sessionForm.knowledgePointId" filterable style="width:100%" @change="onSessionKnowledgeChange"><el-option v-for="item in scheduleKnowledgePoints" :key="item.id" :label="`${item.sequence}. ${item.name}`" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="课次标题"><el-input v-model="sessionForm.title" /></el-form-item>
        <div class="form-row"><el-form-item label="开始"><el-date-picker v-model="sessionForm.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item><el-form-item label="结束"><el-date-picker v-model="sessionForm.endsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item></div><div class="form-row"><el-form-item label="课时"><el-input-number v-model="sessionForm.lessonHours" :min="0" :step="0.5" /></el-form-item><el-form-item label="教室"><el-select v-model="sessionForm.classroom" allow-create filterable clearable style="width:100%" placeholder="选择或输入教室"><el-option v-for="item in classroomOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item></div>
      </el-form><template #footer><el-button @click="sessionVisible=false">取消</el-button><el-button type="primary" @click="submitSession">确认排课</el-button></template>
    </el-dialog>

    <el-dialog v-model="sessionChangeVisible" :title="sessionChangeMode === 'reschedule' ? '调整上课安排' : '创建补课课次'" width="680px" destroy-on-close>
      <el-alert :title="`原课次：${sessionChangeSource?.title || '-'} · ${formatTime(sessionChangeSource?.startsAt || '')}`" type="info" :closable="false" />
      <el-form :model="sessionChangeForm" label-width="90px" class="dialog-form">
        <div class="form-row">
          <el-form-item label="开始"><el-date-picker v-model="sessionChangeForm.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
          <el-form-item label="结束"><el-date-picker v-model="sessionChangeForm.endsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" /></el-form-item>
        </div>
        <el-form-item label="教室"><el-select v-model="sessionChangeForm.classroom" allow-create filterable clearable style="width:100%" placeholder="不填则沿用原教室"><el-option v-for="item in classroomOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <el-form-item label="变更原因"><el-input v-model="sessionChangeForm.reason" type="textarea" :rows="3" placeholder="必填，将写入审计记录" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="sessionChangeVisible=false">返回</el-button><el-button data-testid="submit-session-change" type="primary" :loading="saving" @click="submitSessionChange">确认变更</el-button></template>
    </el-dialog>

    <el-dialog v-model="correctionVisible" title="更正考勤" width="520px" destroy-on-close><el-form :model="correctionForm" label-width="90px"><el-form-item label="状态"><el-select v-model="correctionForm.status" style="width:100%" @change="normalizeCorrectionDeduct"><el-option v-for="item in attendanceOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item><el-form-item label="扣减课时"><el-input-number v-model="correctionForm.deductHours" :min="0" :step="0.5" :disabled="!canDeductForStatus(correctionForm.status)" /></el-form-item><el-form-item label="更正原因"><el-input v-model="correctionForm.reason" type="textarea" :rows="3" /></el-form-item></el-form><template #footer><el-button @click="correctionVisible=false">取消</el-button><el-button data-testid="submit-correction" type="warning" @click="submitCorrection">追加冲正并更正</el-button></template></el-dialog>

    <el-dialog v-model="adjustmentVisible" title="登记课时变动" width="540px" destroy-on-close><el-form :model="adjustmentForm" label-width="90px"><el-form-item label="学生"><el-select v-model="adjustmentForm.studentId" filterable style="width:100%"><el-option v-for="item in balances" :key="item.studentId" :label="`${item.studentName}（余额 ${item.balance}）`" :value="item.studentId" /></el-select></el-form-item><el-form-item label="类型"><el-select v-model="adjustmentForm.type" style="width:100%"><el-option label="购买" value="PURCHASE" /><el-option label="赠送" value="GIFT" /><el-option label="退款" value="REFUND" /><el-option label="人工调整" value="MANUAL_ADJUSTMENT" /></el-select></el-form-item><el-form-item label="课时数量"><el-input-number v-model="adjustmentForm.amount" :step="0.5" /></el-form-item><el-form-item label="说明"><el-input v-model="adjustmentForm.note" /></el-form-item></el-form><template #footer><el-button @click="adjustmentVisible=false">取消</el-button><el-button type="primary" @click="submitAdjustment">写入台账</el-button></template></el-dialog>

    <el-dialog v-model="lessonTypeVisible" :title="lessonTypeEditingId ? '编辑课型' : '新增课型'" width="520px" destroy-on-close><el-form :model="lessonTypeForm" label-width="100px"><el-form-item label="名称"><el-input v-model="lessonTypeForm.name" /></el-form-item><el-form-item label="默认课时"><el-input-number v-model="lessonTypeForm.defaultHours" :min="0" :step="0.5" /></el-form-item><el-form-item label="计入统计"><el-switch v-model="lessonTypeForm.countInStatistics" /></el-form-item><el-form-item label="启用"><el-switch v-model="lessonTypeForm.active" /></el-form-item><el-form-item label="说明"><el-input v-model="lessonTypeForm.description" type="textarea" /></el-form-item></el-form><template #footer><el-button @click="lessonTypeVisible=false">取消</el-button><el-button type="primary" @click="submitLessonType">保存课型</el-button></template></el-dialog>

    <LessonRecordDrawer v-model="lessonRecordVisible" :session-id="lessonRecordSessionId" @changed="load" />
    <ClassroomManager v-model="classroomManagerVisible" />
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue';
import { ref } from 'vue';
import type { AcademicOperationRecord } from '../api';
import { useAcademicOperations } from '../composables/useAcademicOperations';
import LessonRecordDrawer from '../../lesson-records/components/LessonRecordDrawer.vue';
import ScheduleCalendar from './ScheduleCalendar.vue';
import ClassroomManager from './ClassroomManager.vue';
import { useClassroomCatalog } from '../composables/useClassroomCatalog';

const attendanceOptions = [
  { label: '待确认', value: 'UNCONFIRMED' }, { label: '出勤', value: 'PRESENT' },
  { label: '迟到', value: 'LATE' }, { label: '早退', value: 'EARLY_LEAVE' },
  { label: '请假', value: 'LEAVE' }, { label: '缺勤', value: 'ABSENT' }, { label: '补签', value: 'MAKEUP' },
];
const classroomManagerVisible = ref(false);
const { options: classroomOptions } = useClassroomCatalog();

const {
  activeTab, adjustmentForm, adjustmentVisible, attendance, balances, canAdjustHours,
  canConfirmAttendance, canCorrectAttendance, canManageLessonRecords,
  canManageLessonTypes, canManageSchedule, canReadAttendance, canReadCatalog,
  canReadLessonHours, canReadLessonTypes, canReadSchedule, canReconcile, cancelScheduledSession, classes, correctionForm,
  correctionVisible, dateRange, generateForm, generatePreview, generateRemainingCount, generateVisible, ledger, lessonTypeEditingId,
  lessonTypeForm, lessonTypeVisible, lessonTypes, loading, normalizeAttendanceDeduct, normalizeCorrectionDeduct,
  onGenerateKnowledgeChange, onGenerateRuleChange, onRuleClassChange, onRuleLessonTypeChange, onSessionClassChange,
  onSessionKnowledgeChange, onSessionLessonTypeChange, openAdjustment, openAttendance, openCorrection,
  openGenerate, openLessonType, openRule, openSession, openSessionChange, reconciliation,
  ruleEditingId, ruleForm, ruleVisible, rules, saving, scheduleCourse, scheduleKnowledgePoints, scheduleTeachers,
  selectedClassId, selectedSessionId, sessionChangeForm,
  sessionChangeMode, sessionChangeSource, sessionChangeVisible, sessionForm, sessionVisible, sessions,
  submitAdjustment, submitAttendance, submitCorrection, submitGenerate, submitLessonType, submitRule,
  submitSession, submitSessionChange, load, loadAttendance, runReconciliation,
} = useAcademicOperations();

const openCorrectionRow = (row: unknown) => openCorrection(row as AcademicOperationRecord);
const openAdjustmentRow = (row: unknown) => openAdjustment(row as AcademicOperationRecord);
const normalizeAttendanceDeductRow = (row: unknown) => normalizeAttendanceDeduct(row as AcademicOperationRecord);
const openLessonTypeRow = (row: unknown) => openLessonType(row as AcademicOperationRecord);
const openRuleRow = (row: unknown) => openRule(row as AcademicOperationRecord);
const lessonRecordVisible = ref(false);
const lessonRecordSessionId = ref('');
const openLessonRecord = (row: AcademicOperationRecord) => {
  lessonRecordSessionId.value = row.id;
  lessonRecordVisible.value = true;
};
const attendanceStatus = (value: string) => attendanceOptions.find((item) => item.value === value)?.label || value;
const ledgerType = (value: string) => ({ OPENING_BALANCE: '期初余额', PURCHASE: '购买', GIFT: '赠送', CONSUME: '考勤扣减', REVERSAL: '冲正', REFUND: '退款', TRANSFER_IN: '转入', TRANSFER_OUT: '转出', MANUAL_ADJUSTMENT: '人工调整' }[value] || value);
const formatTime = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const dateText = (value: string) => String(value || '').slice(0, 10);
const weekday = (value: number) => ['日', '一', '二', '三', '四', '五', '六'][value] || '-';
const minuteText = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const canDeductForStatus = (value: string) => ['PRESENT', 'LATE', 'MAKEUP'].includes(value);
const catalogStatus = (value: string) => ({ ACTIVE: '启用', PAUSED: '暂停', DISABLED: '停用', ARCHIVED: '归档' }[value] || value);
const catalogStatusType = (value: string): 'success' | 'warning' | 'info' => ({ ACTIVE: 'success', PAUSED: 'warning' }[value] || 'info') as 'success' | 'warning' | 'info';
</script>

<style scoped>
.academic-operations-page { min-height: 0; }
.operations-panel { flex: 1; min-height: 0; overflow: hidden; }
.operations-panel :deep(.el-tabs) { height: 100%; display: flex; flex-direction: column; }
.operations-panel :deep(.el-tabs__content), .operations-panel :deep(.el-tab-pane) { flex: 1; min-height: 0; }
.tab-toolbar { min-height: 44px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.attendance-summary { margin-bottom: 14px; }
.ledger-grid { height: calc(100% - 52px); display: grid; grid-template-columns: minmax(360px, 0.8fr) minmax(560px, 1.4fr); gap: 16px; }
.catalog-section { height: 100%; min-height: 0; overflow: hidden; }
.form-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.form-row:has(.el-form-item:nth-child(3)) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.credit { color: var(--el-color-success); font-weight: 700; }
.debit { color: var(--el-color-danger); font-weight: 700; }
.range-separator { margin: 0 8px; color: var(--el-text-color-secondary); }
.dialog-form { margin-top: 18px; }
.dialog-tip { margin-bottom: 18px; }
.sequence-preview { display: flex; flex-wrap: wrap; gap: 8px 14px; line-height: 28px; }
.sequence-preview > span { display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 1100px) { .ledger-grid { grid-template-columns: 1fr; height: auto; } .ledger-grid > * { height: 440px; } }
</style>
