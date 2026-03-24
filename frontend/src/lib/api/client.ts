function getApiBase() {
  const rewriteLoopbackBase = (baseUrl: string, currentHostname?: string) => {
    if (!currentHostname) {
      return baseUrl;
    }

    try {
      const parsed = new URL(baseUrl);
      const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
      if (loopbackHosts.has(parsed.hostname)) {
        parsed.hostname = currentHostname;
        return parsed.toString().replace(/\/$/, "");
      }
    } catch {
      return baseUrl;
    }

    return baseUrl;
  };

  if (process.env.NEXT_PUBLIC_API_BASE) {
    if (typeof window !== 'undefined') {
      return rewriteLoopbackBase(process.env.NEXT_PUBLIC_API_BASE, window.location.hostname);
    }

    return process.env.NEXT_PUBLIC_API_BASE;
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3001/api`;
  }

  return 'http://localhost:3001/api';
}

// 统一响应格式（与后端 TransformInterceptor 对应）
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
}

// 分页响应格式
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

class ApiClient {
  // 通用请求方法
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${getApiBase()}${path}`;
    const res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const text = await res.text();
    let json: ApiResponse<T> | null = null;

    if (text) {
      try {
        json = JSON.parse(text) as ApiResponse<T>;
      } catch {
        json = null;
      }
    }

    if (!res.ok || !json?.success) {
      throw new Error(json?.message || `请求失败: ${res.status}`);
    }

    return json.data;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

export const api = new ApiClient();
