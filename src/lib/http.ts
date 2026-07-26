// Client-side fetch helper for the JSON API. Same-origin, so the session
// cookie is sent automatically.

export type ApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
};

/**
 * Module-private since the React Query migration: everything goes through the
 * throwing `apiJson`/`apiUploadJson` below, because a query only counts as
 * failed if its function rejects. These stay as the shared plumbing rather
 * than being inlined, so the JSON and multipart paths don't duplicate the
 * response-parsing dance.
 */
async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

/**
 * Multipart upload variant of apiFetch(). No Content-Type header is set, so
 * the browser fills in its own `multipart/form-data; boundary=...` — setting
 * one manually (as apiFetch does for JSON) would drop the boundary and break
 * the upload.
 */
async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  options: Omit<RequestInit, "body" | "headers"> = {},
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method: "POST",
    ...options,
    body: formData,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

/** Extract a human-readable error message from an API error body. */
export function apiError(data: unknown, fallback = "Something went wrong") {
  if (data && typeof data === "object" && "error" in data) {
    return String((data as { error: unknown }).error);
  }
  return fallback;
}

/**
 * A non-2xx response as a thrown Error, which is the only thing React Query
 * treats as a failure — apiFetch() resolves with `{ok:false}`, so a query
 * built on it would report success with an error body as its data.
 *
 * Carries `status` because both the retry predicate and the global 401 handler
 * branch on it; a plain Error would lose that.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, data: unknown) {
    super(apiError(data, `Request failed with status ${status}`));
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

/** Throwing variant of apiFetch(), for React Query query/mutation functions. */
export async function apiJson<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await apiFetch<T>(path, options);
  if (!res.ok) throw new ApiError(res.status, res.data);
  return res.data;
}

/** Throwing variant of apiUpload(). The same multipart caveat applies. */
export async function apiUploadJson<T = unknown>(
  path: string,
  formData: FormData,
  options: Omit<RequestInit, "body" | "headers"> = {},
): Promise<T> {
  const res = await apiUpload<T>(path, formData, options);
  if (!res.ok) throw new ApiError(res.status, res.data);
  return res.data;
}
