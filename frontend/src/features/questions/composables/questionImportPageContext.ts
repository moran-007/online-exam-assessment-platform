import { inject, provide, type InjectionKey } from 'vue';

const questionImportPageKey: InjectionKey<Record<string, any>> = Symbol('question-import-page');

export function provideQuestionImportPageContext(context: Record<string, any>) {
  provide(questionImportPageKey, context);
}

export function useQuestionImportPageContext(): any {
  const context = inject(questionImportPageKey);
  if (!context) throw new Error('QuestionImportPage context is unavailable');
  return context;
}
