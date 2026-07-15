export type HydroRecord = Record<string, any>;

export type HydroPage = {
  items: HydroRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type HydroLoginState = {
  lastLoginStatus?: unknown;
  lastLoginMessage?: string | null;
};
