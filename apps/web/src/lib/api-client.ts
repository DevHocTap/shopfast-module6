/** Error contract returned by the API: `{ statusCode, code, message, requestId }`. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const NETWORK_ERROR_MESSAGE = 'Không kết nối được tới máy chủ. Kiểm tra mạng rồi thử lại.';

/**
 * Minimal fetch wrapper. Phase 1 adds the bearer token, refresh-on-401 and 429 handling.
 * `acceptStatuses` lets callers read a body that comes with a non-2xx status (e.g. health 503).
 */
export async function apiGet<T>(path: string, acceptStatuses: number[] = []): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }

  const body: unknown = await response.json().catch(() => null);
  if (response.ok || acceptStatuses.includes(response.status)) {
    return body as T;
  }

  const error = (body ?? {}) as { code?: string; message?: string };
  throw new ApiError(
    response.status,
    error.code ?? 'UNKNOWN',
    error.message ?? `Máy chủ trả lỗi ${response.status}.`,
  );
}
