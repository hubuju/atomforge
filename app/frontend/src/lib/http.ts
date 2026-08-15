/**
 * Minimal fetch wrapper replacing the Atoms Web SDK transport.
 *
 * The original code sent every hub call through `client.apiCall.invoke()`,
 * which only works while the app is hosted on Atoms Cloud. The backend routes
 * themselves are untouched — this module just talks to them over plain fetch,
 * same-origin, so the whole app can be served by our own FastAPI process.
 *
 * Errors are shaped like the SDK's failures ({ data: { detail } }) so the
 * existing `errorText()` helper keeps working without changes.
 */

export class HttpError extends Error {
  data: { detail?: string } | null;
  response: { data?: { detail?: string } } | null;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'HttpError';
    this.data = detail ? { detail } : null;
    this.response = null;
  }
}

interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: unknown;
}

export async function http<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const { method = 'POST', data } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: data !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new HttpError('无法连接服务器，请检查网络后重试');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail =
      (payload as { detail?: string } | null)?.detail || `请求失败（${response.status}）`;
    throw new HttpError(detail, detail);
  }

  return payload as T;
}
