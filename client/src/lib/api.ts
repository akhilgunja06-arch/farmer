/**
 * The single place the app talks to the API.
 *
 * Two rules hold everywhere:
 *  1. `credentials: 'include'` — the session is an httpOnly cookie, never a
 *     token in JavaScript. That keeps it out of reach of any script that ends
 *     up on the page.
 *  2. The server's error shape is preserved rather than flattened to a string,
 *     so a form can attach `fieldErrors` to the right input.
 */

export interface ApiFieldErrors {
  [field: string]: string;
}

export interface ApiErrorBody {
  message: string;
  code: string;
  fieldErrors?: ApiFieldErrors;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: ApiFieldErrors | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fieldErrors = body.fieldErrors;
  }

  /** True when the caller simply is not signed in. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** True when signed in but not permitted — a different problem, different fix. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '';

type QueryValue = string | number | boolean | null | undefined | Array<string | number>;

function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      // Repeated keys, matching how Express parses arrays by default.
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    params?: Record<string, QueryValue>;
    signal?: AbortSignal;
    /** Set for FormData so the browser supplies the multipart boundary. */
    raw?: BodyInit;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;

  if (options.raw !== undefined) {
    body = options.raw;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${BASE}${path}${buildQuery(options.params)}`, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload: unknown = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const errorBody =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: ApiErrorBody }).error
        : {
            message: `The request failed (${response.status}).`,
            code: 'REQUEST_FAILED',
          };
    throw new ApiError(response.status, errorBody);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, QueryValue>, signal?: AbortSignal) =>
    request<T>('GET', path, { params, signal }),

  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),

  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),

  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),

  delete: <T>(path: string) => request<T>('DELETE', path),

  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { raw: form }),
};

/**
 * Turns any thrown value into a message safe to show a user.
 *
 * A network failure and a 500 both land here. Neither should leak a stack
 * trace to the screen, but both should say something more useful than
 * "something went wrong".
 */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

/** Field-level messages from a validation failure, for react-hook-form. */
export function fieldErrorsOf(error: unknown): ApiFieldErrors {
  return error instanceof ApiError ? (error.fieldErrors ?? {}) : {};
}
