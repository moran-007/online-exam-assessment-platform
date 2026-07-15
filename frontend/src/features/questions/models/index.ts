export type QuestionRecord = Record<string, any>;

export type QuestionPage = {
  items: QuestionRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type QuestionAssetReport = {
  total: number;
  referencedCount: number;
  orphanCount: number;
  items?: Array<Record<string, any>>;
};
