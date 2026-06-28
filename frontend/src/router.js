import { createRouter, createWebHistory } from 'vue-router';
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
import StudentProfileView from './views/StudentProfileView.vue';

const routes = [
  { path: '/login', component: LoginView, meta: { public: true } },
  { path: '/question-bank', component: PublicQuestionView, meta: { public: true } },
  { path: '/public/questions', redirect: '/question-bank', meta: { public: true } },
  { path: '/', redirect: () => (getCurrentUser()?.userType === 'STUDENT' ? '/student/exams' : '/dashboard') },
  { path: '/dashboard', component: DashboardView },
  { path: '/courses', component: CourseView },
  { path: '/classes', component: ClassView },
  { path: '/knowledge', component: KnowledgeView },
  { path: '/tags', component: TagView },
  { path: '/questions', component: QuestionView },
  { path: '/question-import', component: QuestionImportView },
  { path: '/papers', component: PaperView },
  { path: '/papers/:paperId/answer', component: PaperAnswerView },
  { path: '/exams', component: ExamView },
  { path: '/grading', component: GradingView },
  { path: '/exports', component: ExportView },
  { path: '/statistics', component: StatisticsView },
  { path: '/student/exams', component: StudentExamView },
  { path: '/student/exams/:examId', component: ExamTakingView },
  { path: '/student/attempts/:attemptId/result', component: ResultView },
  { path: '/student/wrong-questions', component: WrongQuestionView },
  { path: '/student/profile', component: StudentProfileView },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (!to.meta.public && !getToken() && !getRefreshToken()) {
    return '/login';
  }
  if (to.path === '/login' && getToken()) {
    return '/';
  }
  return true;
});

export default router;
