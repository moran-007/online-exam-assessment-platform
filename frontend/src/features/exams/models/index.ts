export type ExamRecord = Record<string, any>;

export type ExamPage = {
  items: ExamRecord[];
  total: number;
  page: number;
  pageSize: number;
};
