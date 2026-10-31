/** Error contract returned by the API: `{ statusCode, code, message, details?, requestId }`. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const NETWORK_ERROR_MESSAGE = 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.';

/** Supplied by AuthProvider: the in-memory access token and a way to renew it. */
export interface TokenSource {
  current(): string | null;
  refresh(): Promise<string | null>;
}

let tokenSource: TokenSource = { current: () => null, refresh: async () => null };

export function setTokenSource(source: TokenSource): void {
  tokenSource = source;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  /** Non-2xx statuses whose body should still be returned (e.g. health 503). */
  acceptStatuses?: number[];
  /** Set to false for the auth endpoints themselves, to avoid a refresh loop. */
  retryOnUnauthorized?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await sendAuthenticated(path, options);
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok || options.acceptStatuses?.includes(response.status)) return body as T;
  throw toApiError(response.status, body);
}

/** For non-JSON documents (e.g. the HTML invoice); errors still use the JSON contract. */
export async function apiText(path: string): Promise<string> {
  const response = await sendAuthenticated(path, { headers: { Accept: 'text/html' } });
  if (response.ok) return response.text();
  throw toApiError(response.status, await response.json().catch(() => null));
}

async function sendAuthenticated(path: string, options: RequestOptions): Promise<Response> {
  const response = await send(path, options, tokenSource.current());

  // Access token expired: renew it once through the httpOnly refresh cookie, then replay.
  if (response.status === 401 && options.retryOnUnauthorized !== false && tokenSource.current()) {
    const fresh = await tokenSource.refresh();
    if (fresh) return send(path, options, fresh);
  }
  return response;
}

function toApiError(status: number, body: unknown): ApiError {
  const error = (body ?? {}) as { code?: string; message?: string; details?: unknown };
  return new ApiError(
    status,
    error.code ?? 'UNKNOWN',
    error.message ?? `Máy chủ trả lỗi ${status}.`,
    error.details,
  );
}

async function send(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    return await fetch(`/api${path}${toQueryString(options.query)}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }
}

function toQueryString(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const apiGet = <T>(path: string, acceptStatuses: number[] = []): Promise<T> =>
  api<T>(path, { acceptStatuses });

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.';
