export type ExportRecord = Record<string, any>;

export type ExportPage = {
  items: ExportRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type ExportTaskStatus = 'pending' | 'processing' | 'success' | 'failed' | 'canceled' | 'expired';
