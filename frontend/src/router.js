import { createRouter, createWebHistory } from 'vue-router';
import { canAccessByMeta, firstAccessiblePath } from './access';
import { getCurrentUser, getRefreshToken, getToken } from './api';
import LoginView from './views/LoginView.vue';
import DashboardView from './views/DashboardView.vue';
import CourseView from './views/CourseView.vue';
import ClassView from './views/ClassView.vue';
import KnowledgeView from './views/KnowledgeView.vue';
import TagView from './views/TagView.vue';
import QuestionView from './views/QuestionView.vue';
import QuestionImportView from './views/QuestionImportView.vue';
import PaperView from './views/PaperView.vue';
import PaperAnswerView from './views/PaperAnswerView.vue';
import ExamView from './views/ExamView.vue';
import GradingView from './views/GradingView.vue';
import ExportView from './views/ExportView.vue';
import StatisticsView from './views/StatisticsView.vue';
import StudentExamView from './views/StudentExamView.vue';
import ExamTakingView from './views/ExamTakingView.vue';
import ResultView from './views/ResultView.vue';
import WrongQuestionView from './views/WrongQuestionView.vue';
import PublicQuestionView from './views/PublicQuestionView.vue';
import StudentPaperBankView from './views/StudentPaperBankView.vue';
import StudentProfileView from './views/StudentProfileView.vue';
import ExternalAccountView from './views/ExternalAccountView.vue';
import UserManagementView from './views/UserManagementView.vue';

const routes = [
  { path: '/login', component: LoginView, meta: { public: true } },
  { path: '/question-bank', component: PublicQuestionView, meta: { public: true } },
  { path: '/public/questions', redirect: '/question-bank', meta: { public: true } },
  { path: '/', redirect: () => firstAccessiblePath(getCurrentUser()) },
  { path: '/dashboard', component: DashboardView, meta: { adminOnly: true, permissions: ['statistics:read'] } },
  { path: '/courses', component: CourseView, meta: { adminOnly: true, permissions: ['course:read'] } },
  { path: '/classes', component: ClassView, meta: { adminOnly: true, permissions: ['class:read'] } },
  { path: '/users', component: UserManagementView, meta: { adminOnly: true, userTypes: ['SUPER_ADMIN'] } },
  { path: '/knowledge', component: KnowledgeView, meta: { adminOnly: true, permissions: ['knowledge-point:read'] } },
  { path: '/tags', component: TagView, meta: { adminOnly: true, permissions: ['tag:read'] } },
  { path: '/questions', component: QuestionView, meta: { adminOnly: true, permissions: ['question:read'] } },
  { path: '/question-import', component: QuestionImportView, meta: { adminOnly: true, permissions: ['question:create'] } },
  { path: '/papers', component: PaperView, meta: { adminOnly: true, permissions: ['paper:read'] } },
  { path: '/papers/:paperId/answer', component: PaperAnswerView },
  { path: '/exams', component: ExamView, meta: { adminOnly: true, permissions: ['exam:read'] } },
  { path: '/grading', component: GradingView, meta: { adminOnly: true, permissions: ['grading:read'] } },
  { path: '/exports', component: ExportView, meta: { adminOnly: true, permissions: ['exam:result:export'] } },
  { path: '/statistics', component: StatisticsView, meta: { adminOnly: true, permissions: ['statistics:read'] } },
  {
    path: '/external-accounts',
    component: ExternalAccountView,
    meta: { adminOnly: true, userTypes: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'] },
  },
  { path: '/student/exams', component: StudentExamView, meta: { studentOnly: true } },
  { path: '/student/exams/:examId', component: ExamTakingView, meta: { studentOnly: true } },
  { path: '/student/attempts/:attemptId/result', component: ResultView, meta: { studentOnly: true } },
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
  if (!to.meta.public && !getToken() && !getRefreshToken()) {
    return '/login';
  }
  if (to.path === '/login' && getToken()) {
    return firstAccessiblePath(user);
  }
  if (!canAccessByMeta(user, to.meta)) {
    return user ? firstAccessiblePath(user) : '/login';
  }
  return true;
});

export default router;
