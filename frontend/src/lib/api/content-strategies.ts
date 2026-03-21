import { api } from './client';

export interface ContentStrategy {
  id: string;
  name: string;
  description?: string | null;
  industry: string;
  targetAudience: string;
  commercialGoal: string;
  corePainPoints: string;
  writingAngles: string;
  toneAndStyle?: string | null;
  sourceIds: string[];
  isDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentStrategyPayload {
  name: string;
  description?: string;
  industry?: string;
  targetAudience: string;
  commercialGoal: string;
  corePainPoints: string;
  writingAngles: string;
  toneAndStyle?: string;
  sourceIds?: string[];
  isDefault?: boolean;
  enabled?: boolean;
}

export const contentStrategiesApi = {
  list() {
    return api.get<ContentStrategy[]>('/content-strategies');
  },

  getDefault() {
    return api.get<ContentStrategy>('/content-strategies/default');
  },

  create(data: ContentStrategyPayload) {
    return api.post<ContentStrategy>('/content-strategies', data);
  },

  update(id: string, data: Partial<ContentStrategyPayload>) {
    return api.put<ContentStrategy>(`/content-strategies/${id}`, data);
  },

  remove(id: string) {
    return api.delete<ContentStrategy>(`/content-strategies/${id}`);
  },

  setDefault(id: string) {
    return api.patch<ContentStrategy[]>(`/content-strategies/${id}/default`);
  },
};
