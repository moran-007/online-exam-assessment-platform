import { onBeforeUnmount, type Ref } from 'vue';
import type { ExportTask } from '../models';

export function useExportTaskPolling(
  tasks: Ref<ExportTask[]>,
  reload: () => Promise<unknown>,
  intervalMs = 1500,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    stop();
    if (!tasks.value.some((task) => ['pending', 'processing'].includes(String(task.status)))) return;
    timer = setTimeout(() => void reload(), intervalMs);
  };

  onBeforeUnmount(stop);
  return { schedule, stop };
}
