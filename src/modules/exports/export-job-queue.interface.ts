export const EXPORT_JOB_QUEUE = Symbol('EXPORT_JOB_QUEUE');

export type ExportJobLease = {
  taskId: string;
  owner: string;
};

export type ExportJobHandler = (lease: ExportJobLease) => Promise<void>;

export interface ExportJobQueue {
  start(handler: ExportJobHandler): Promise<void>;
  stop(): Promise<void>;
  enqueue(taskId: string): void;
  cancel(taskId: string): void;
}
