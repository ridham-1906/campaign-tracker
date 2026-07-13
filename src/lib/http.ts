// Client-side fetch helper for the JSON API. Same-origin, so the session
// cookie is sent automatically.

export type ApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
};

export async function apiFetch<T = unknown>(
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

/** Extract a human-readable error message from an API error body. */
export function apiError(data: unknown, fallback = "Something went wrong") {
  if (data && typeof data === "object" && "error" in data) {
    return String((data as { error: unknown }).error);
  }
  return fallback;
}
