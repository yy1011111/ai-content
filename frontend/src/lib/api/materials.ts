import { api, PaginatedData } from './client';

export type XiaohongshuSortType =
  | 'general'
  | 'time_descending'
  | 'popularity_descending'
  | 'comment_descending'
  | 'collect_descending';

export type XiaohongshuTimeRangeType = 'all' | '1d' | '7d' | '30d';

export interface Material {
  id: string;
  title: string;
  content?: string;
  summary?: string;
  sourceUrl: string;
  platform: string;
  author: string;
  publishDate: string | null;
  collectDate: string;
  status: 'unmined' | 'mined' | 'failed';
  keywords: string[];
  metadata?: {
    materialCategory?: string;
    referenceKeyword?: string;
    sourceKind?: string;
    sortType?: XiaohongshuSortType;
    sortLabel?: string;
    timeRange?: XiaohongshuTimeRangeType;
    timeRangeLabel?: string;
    signal?: {
      likeCount?: string | null;
      collectCount?: string | null;
      commentCount?: string | null;
    };
  };
  createdAt: string;
  updatedAt: string;
}

export interface MaterialStats {
  total: number;
  unmined: number;
  mined: number;
  failed: number;
  byPlatform: { platform: string; count: number }[];
}

export interface MaterialQuery {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  platform?: string;
  category?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
  if (entries.length === 0) return '';
  return `?${entries.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')}`;
}

export const materialsApi = {
  list(query: MaterialQuery = {}) {
    return api.get<PaginatedData<Material>>(`/materials${buildQuery(query as Record<string, unknown>)}`);
  },

  getById(id: string) {
    return api.get<Material>(`/materials/${id}`);
  },

  stats() {
    return api.get<MaterialStats>('/materials/stats');
  },

  collect(sourceIds?: string[]) {
    return api.post<{ jobCount: number; message: string }>('/materials/collect', { sourceIds });
  },

  loginXiaohongshu() {
    return api.post<{ success: boolean; message: string }>('/materials/xiaohongshu/login', {});
  },

  collectXiaohongshuKeyword(
    keyword: string,
    limit: number = 12,
    sort: XiaohongshuSortType = 'general',
    timeRange: XiaohongshuTimeRangeType = '7d',
  ) {
    return api.post<{
      keyword: string;
      sort: XiaohongshuSortType;
      timeRange: XiaohongshuTimeRangeType;
      total: number;
      saved: number;
      createdMaterialIds: string[];
      message: string;
    }>('/materials/xiaohongshu/keyword-collect', {
      keyword,
      limit,
      sort,
      timeRange,
    });
  },

  remove(id: string) {
    return api.delete<Material>(`/materials/${id}`);
  },

  batchRemove(ids: string[]) {
    return api.post<{ deleted: number }>('/materials/batch-delete', { ids });
  },
};
