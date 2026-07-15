import { createRouter, createWebHistory } from 'vue-router';
import { canAccessByMeta, firstAccessiblePath, isPrivilegedUser } from './access';
import { getCurrentUser, getRefreshToken, getToken, hasActiveSession } from './api';

const LoginView = () => import('./views/LoginView.vue');
const DashboardView = () => import('./views/DashboardView.vue');
const CourseView = () => import('./views/CourseView.vue');
const ClassView = () => import('./views/ClassView.vue');
const KnowledgeView = () => import('./views/KnowledgeView.vue');
const TagView = () => import('./views/TagView.vue');
const QuestionView = () => import('./views/QuestionView.vue');
const QuestionImportView = () => import('./views/QuestionImportView.vue');
const PaperView = () => import('./views/PaperView.vue');
const PaperAnswerView = () => import('./views/PaperAnswerView.vue');
const ExamView = () => import('./views/ExamView.vue');
const GradingWorkbenchView = () => import('./views/GradingWorkbenchView.vue');
const ExportView = () => import('./views/ExportView.vue');
const StatisticsView = () => import('./views/StatisticsView.vue');
const StudentExamView = () => import('./views/StudentExamView.vue');
const ExamTakingView = () => import('./views/ExamTakingView.vue');
const AttemptReviewView = () => import('./views/AttemptReviewView.vue');
const WrongQuestionView = () => import('./views/WrongQuestionView.vue');
const PublicQuestionView = () => import('./views/PublicQuestionView.vue');
const StudentPaperBankView = () => import('./views/StudentPaperBankView.vue');
const StudentProfileView = () => import('./views/StudentProfileView.vue');
const ExternalAccountView = () => import('./views/ExternalAccountView.vue');
const UserManagementView = () => import('./views/UserManagementView.vue');
const AiSettingsView = () => import('./views/AiSettingsView.vue');

const routes = [
  { path: '/login', component: LoginView, meta: { public: true } },
  { path: '/question-bank', component: PublicQuestionView, meta: { public: true } },
  { path: '/public/questions', redirect: '/question-bank', meta: { public: true } },
  { path: '/', redirect: () => firstAccessiblePath(getCurrentUser()) },
  { path: '/dashboard', component: DashboardView, meta: { adminOnly: true, permissions: ['statistics:read'] } },
  { path: '/courses', component: CourseView, meta: { adminOnly: true, permissions: ['course:read'] } },
  { path: '/classes', component: ClassView, meta: { adminOnly: true, permissions: ['class:read'] } },
  { path: '/users', component: UserManagementView, meta: { adminOnly: true, userTypes: ['SUPER_ADMIN'] } },
  { path: '/ai-settings', component: AiSettingsView, meta: { adminOnly: true, userTypes: ['SUPER_ADMIN'] } },
  { path: '/knowledge', component: KnowledgeView, meta: { adminOnly: true, permissions: ['knowledge-point:read'] } },
  { path: '/tags', component: TagView, meta: { adminOnly: true, permissions: ['tag:read'] } },
  { path: '/questions', component: QuestionView, meta: { adminOnly: true, permissions: ['question:read'] } },
  { path: '/question-import', component: QuestionImportView, meta: { adminOnly: true, permissions: ['question:create'] } },
  { path: '/papers', component: PaperView, meta: { adminOnly: true, permissions: ['paper:read'] } },
  { path: '/papers/:paperId/answer', component: PaperAnswerView },
  { path: '/exams', component: ExamView, meta: { adminOnly: true, permissions: ['exam:read'] } },
  { path: '/grading', component: GradingWorkbenchView, meta: { adminOnly: true, permissions: ['grading:read'] } },
  { path: '/exports', component: ExportView, meta: { adminOnly: true, permissions: ['exam:result:export'] } },
  { path: '/statistics', component: StatisticsView, meta: { adminOnly: true, permissions: ['statistics:read'] } },
  {
    path: '/external-accounts',
    component: ExternalAccountView,
    meta: { adminOnly: true, userTypes: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'] },
  },
  { path: '/student/exams', component: StudentExamView, meta: { studentOnly: true } },
  { path: '/student/exams/:examId', component: ExamTakingView, meta: { studentOnly: true, simulationAllowed: true } },
  { path: '/student/attempts/:attemptId/result', component: AttemptReviewView, meta: { studentOnly: true, simulationAllowed: true } },
  { path: '/student/papers', component: StudentPaperBankView, meta: { studentOnly: true } },
  { path: '/student/wrong-questions', component: WrongQuestionView, meta: { studentOnly: true } },
  { path: '/student/profile', component: StudentProfileView, meta: { studentOnly: true } },
  { path: '/profile', component: StudentProfileView },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const user = getCurrentUser();
  const hadStoredSession = Boolean(getToken() || getRefreshToken());
  const activeSession = hasActiveSession();
  if (!to.meta.public && !activeSession) {
    return hadStoredSession ? { path: '/login', query: { reason: 'expired' } } : '/login';
  }
  if (to.path === '/login' && activeSession) {
    return firstAccessiblePath(user);
  }
  const simulationAccess = Boolean(to.meta.simulationAllowed && to.query.simulateStudentId && isPrivilegedUser(user));
  if (!canAccessByMeta(user, to.meta) && !simulationAccess) {
    return user ? firstAccessiblePath(user) : '/login';
  }
  return true;
});

export default router;
