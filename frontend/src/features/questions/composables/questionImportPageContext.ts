import { inject, provide, type InjectionKey } from 'vue';
import type { useQuestionImportPage } from './useQuestionImportPage';

type QuestionImportPageContext = ReturnType<typeof useQuestionImportPage>;
const questionImportPageKey: InjectionKey<QuestionImportPageContext> = Symbol('question-import-page');

export function provideQuestionImportPageContext(context: QuestionImportPageContext) {
  provide(questionImportPageKey, context);
}

export function useQuestionImportPageContext(): QuestionImportPageContext {
  const context = inject(questionImportPageKey);
  if (!context) throw new Error('QuestionImportPage context is unavailable');
  return context;
}
