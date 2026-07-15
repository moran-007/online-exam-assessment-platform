import { inject, provide, type InjectionKey } from 'vue';

const questionPageKey: InjectionKey<Record<string, any>> = Symbol('question-page');

export function provideQuestionPageContext(context: Record<string, any>) {
  provide(questionPageKey, context);
}

export function useQuestionPageContext(): any {
  const context = inject(questionPageKey);
  if (!context) throw new Error('QuestionPage context is unavailable');
  return context;
}
