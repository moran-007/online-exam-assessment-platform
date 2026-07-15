import { inject, provide, type InjectionKey } from 'vue';

const statisticsPageKey: InjectionKey<Record<string, any>> = Symbol('statistics-page');

export function provideStatisticsPageContext(context: Record<string, any>) {
  provide(statisticsPageKey, context);
}

export function useStatisticsPageContext(): any {
  const context = inject(statisticsPageKey);
  if (!context) throw new Error('StatisticsPage context is unavailable');
  return context;
}
