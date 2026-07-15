import { inject, provide, type InjectionKey } from 'vue';
import type { useQuestionPage } from './useQuestionPage';

type QuestionPageContext = ReturnType<typeof useQuestionPage>;
const questionPageKey: InjectionKey<QuestionPageContext> = Symbol('question-page');

export function provideQuestionPageContext(context: QuestionPageContext) {
  provide(questionPageKey, context);
}

export function useQuestionPageContext(): QuestionPageContext {
  const context = inject(questionPageKey);
  if (!context) throw new Error('QuestionPage context is unavailable');
  return context;
}
