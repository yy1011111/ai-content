import { api } from './client';

export interface CreateArticlesScheduleConfig {
  minScore?: number;
  limit?: number;
  contentType?: 'article' | 'xiaohongshu';
  autoPublish?: boolean;
  publishAccountId?: string;
}

export interface ScheduleConfig {
  taskType: string;
  cronExpr: string;
  enabled: boolean;
  config?: CreateArticlesScheduleConfig;
  lastRunTime?: string;
}

export const schedulesApi = {
  list() {
    return api.get<ScheduleConfig[]>('/schedules');
  },

  update(taskType: string, data: Partial<ScheduleConfig>) {
    return api.put<ScheduleConfig>(`/schedules/${taskType}`, data);
  },
};
