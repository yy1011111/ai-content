import { api } from './client';

export interface Style {
    id: string;
    name: string;
    description?: string;
    promptTemplate: string;
    parameters?: Record<string, unknown>;
    isDefault: boolean;
    type: StyleType;
    createdAt: string;
    updatedAt: string;
}

export type StyleType = 'article' | 'image' | 'template' | 'xiaohongshu' | 'article_system';

export const stylesApi = {
    // 获取所有风格，支持按类型过滤
    list: (type?: string) => api.get<Style[]>(type ? `/styles?type=${type}` : '/styles'),

    // 获取单个风格
    getById: (id: string) => api.get<Style>(`/styles/${id}`),

    // 创建风格
    create: (data: Partial<Style>) => api.post<Style>('/styles', data),

    // 更新风格
    update: (id: string, data: Partial<Style>) => api.put<Style>(`/styles/${id}`, data),

    // 删除风格
    remove: (id: string) => api.delete<void>(`/styles/${id}`),

    // 设为默认
    setDefault: (id: string) => api.patch<void>(`/styles/${id}/default`),
};
