import { inject, provide, type InjectionKey } from 'vue';
import type { useStatisticsPage } from './useStatisticsPage';

type StatisticsPageContext = ReturnType<typeof useStatisticsPage>;
const statisticsPageKey: InjectionKey<StatisticsPageContext> = Symbol('statistics-page');

export function provideStatisticsPageContext(context: StatisticsPageContext) {
  provide(statisticsPageKey, context);
}

export function useStatisticsPageContext(): StatisticsPageContext {
  const context = inject(statisticsPageKey);
  if (!context) throw new Error('StatisticsPage context is unavailable');
  return context;
}
