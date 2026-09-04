import type { ApiError } from './types';

export class AuthenticationError extends Error {
  constructor() {
    super('SESSION_EXPIRED');
    this.name = 'AuthenticationError';
  }
}

export async function apiClient<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...request } = options;
  const headers = new Headers(request.headers);
  headers.set('Accept', 'application/json');
  if (request.body !== undefined && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...request, headers });
  if (response.status === 401) throw new AuthenticationError();
  if (!response.ok) {
    let error: Partial<ApiError> = {};
    try {
      error = (await response.json()) as Partial<ApiError>;
    } catch {
      // Keep the public error stable when the upstream response is not JSON.
    }
    throw new Error(error.code ?? `HTTP_${response.status}`);
  }
  return (await response.json()) as T;
}
