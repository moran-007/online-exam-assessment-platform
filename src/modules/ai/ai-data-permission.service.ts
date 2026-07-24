import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { hasPermission } from '../../common/security/permission-policy';
import type { SummaryDataDomain } from './datasets/summary-scope';

export const AI_DATA_DOMAINS = [
  {
    domain: 'grade_history',
    name: '成绩历史',
    description: '考试成绩、题目表现、知识点掌握及历史趋势',
    category: 'student',
    businessPermission: 'grading:score:read',
    aiPermission: 'ai.data.grade-history',
  },
  {
    domain: 'attendance',
    name: '出勤情况',
    description: '已确认的到课、迟到、请假、早退和缺勤记录',
    category: 'student',
    businessPermission: 'attendance:read',
    aiPermission: 'ai.data.attendance',
  },
  {
    domain: 'schedule',
    name: '排课情况',
    description: '课次时间、课程安排、课时及课堂公开记录',
    category: 'teaching',
    businessPermission: 'schedule:read',
    aiPermission: 'ai.data.schedule',
  },
  {
    domain: 'student_identity',
    name: '学生实名',
    description: '允许将学生真实姓名发送给模型并在结果中直接点名',
    category: 'identity',
    businessPermission: 'student:identity:read',
    aiPermission: 'ai.data.student-identity',
  },
  {
    domain: 'teacher_identity',
    name: '教师实名',
    description: '允许将教师真实姓名发送给模型并在结果中直接点名',
    category: 'identity',
    businessPermission: 'academic-profile:read',
    aiPermission: 'ai.data.teacher-identity',
  },
  {
    domain: 'teacher_materials',
    name: '教师教学资料',
    description: '教学记录、课堂表现、备课内容和教师内部备注',
    category: 'teaching',
    businessPermission: 'lesson-record:read',
    aiPermission: 'ai.data.teacher-materials',
  },
] as const;

export type AiDataDomain = (typeof AI_DATA_DOMAINS)[number]['domain'];

const SUMMARY_DOMAINS: Record<AiSummaryType, AiDataDomain[]> = {
  [AiSummaryType.EXAM]: ['grade_history'],
  [AiSummaryType.STUDENT]: ['grade_history', 'attendance', 'schedule'],
  [AiSummaryType.CLASS]: ['grade_history', 'attendance', 'schedule'],
  [AiSummaryType.PARENT_REPORT]: ['grade_history', 'attendance', 'schedule'],
  [AiSummaryType.LESSON]: ['schedule', 'teacher_materials'],
};

@Injectable()
export class AiDataPermissionService {
  async assertSummaryAllowed(type: AiSummaryType, user: RequestUser, summaryDomains?: SummaryDataDomain[]) {
    const required = summaryDomains && (
      type === AiSummaryType.STUDENT || type === AiSummaryType.CLASS || type === AiSummaryType.PARENT_REPORT
    )
      ? this.selectedSummaryDomains(summaryDomains)
      : SUMMARY_DOMAINS[type];
    await this.assertAllowed(required, user);
  }

  private selectedSummaryDomains(domains: SummaryDataDomain[]): AiDataDomain[] {
    const required = new Set<AiDataDomain>();
    if (domains.includes('exams')) required.add('grade_history');
    if (domains.includes('lessons')) {
      required.add('attendance');
      required.add('schedule');
    }
    if (domains.includes('homework')) required.add('schedule');
    return [...required];
  }

  async assertAllowed(domains: AiDataDomain[], user: RequestUser) {
    const decisions = await Promise.all(domains.map(async (domain) => ({
      domain,
      allowed: await this.isAllowed(domain, user),
    })));
    const denied = decisions.filter((item) => !item.allowed).map((item) => this.definition(item.domain).name);
    if (denied.length) {
      throw new ForbiddenException(`AI 数据权限未开放：${denied.join('、')}。请联系超级管理员调整 AI 数据权限。`);
    }
  }

  async isAllowed(domain: AiDataDomain, user: RequestUser) {
    const definition = this.definition(domain);
    return hasPermission(user, definition.businessPermission) && hasPermission(user, definition.aiPermission);
  }

  private definition(domain: string) {
    const definition = AI_DATA_DOMAINS.find((item) => item.domain === domain);
    if (!definition) throw new NotFoundException('未知的 AI 数据权限域');
    return definition;
  }

}
