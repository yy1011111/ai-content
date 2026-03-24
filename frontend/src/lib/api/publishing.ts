import { api } from './client';

export interface PublishAccountConfig {
  apiUrl?: string;
  openComment?: number;
  onlyFansCanComment?: number;
  categoryId?: string | number;
  creatorUrl?: string;
}

export interface PublishAccount {
  id: string;
  platform: 'wechat' | 'xiaohongshu' | string;
  name: string;
  appId?: string;
  apiToken?: string;
  config?: PublishAccountConfig;
  createdAt: string;
  updatedAt: string;
}

export interface PublishRecord {
  id: string;
  articleId: string;
  accountId: string;
  platform: string;
  status: 'pending' | 'success' | 'failed';
  publishUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  account?: PublishAccount;
}

export interface PublishResponse {
  success: boolean;
  articleId: string;
  publishUrl?: string;
  deliveryStatus: 'draft' | 'published';
  message: string;
}

export interface PublishConnectionTestResponse {
  success: boolean;
  platform: string;
  message: string;
  details?: Record<string, unknown>;
}

export const publishingApi = {
  getAccounts() {
    return api.get<PublishAccount[]>('/publishing/accounts');
  },

  createAccount(data: Partial<PublishAccount>) {
    return api.post<PublishAccount>('/publishing/accounts', data);
  },

  updateAccount(id: string, data: Partial<PublishAccount>) {
    return api.put<PublishAccount>(`/publishing/accounts/${id}`, data);
  },

  deleteAccount(id: string) {
    return api.delete(`/publishing/accounts/${id}`);
  },

  testAccountConnection(id: string) {
    return api.post<PublishConnectionTestResponse>(`/publishing/accounts/${id}/test`, {});
  },

  startXiaohongshuLogin(id: string) {
    return api.post<{ success: boolean; message: string }>(`/publishing/accounts/${id}/xiaohongshu/login`, {});
  },

  getXiaohongshuStatus(id: string) {
    return api.get<{ loggedIn: boolean; currentUrl?: string }>(`/publishing/accounts/${id}/xiaohongshu/status`);
  },

  publishArticle(articleId: string, accountId: string) {
    return api.post<PublishResponse>('/publishing/publish', { articleId, accountId });
  },

  getRecords(articleId: string) {
    return api.get<PublishRecord[]>(`/publishing/records/${articleId}`);
  },
};
