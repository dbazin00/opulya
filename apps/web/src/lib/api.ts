export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
  options?: { background?: boolean },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(options?.background ? { "X-Opulya-Poll": "1" } : {}),
        ...(body !== undefined
          ? { "Content-Type": "application/json", "X-Opulya-Request": "1" }
          : {}),
      },
      ...(body !== undefined
        ? {
            method,
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", 0);
  }
  const result = (await response.json().catch(() => ({}))) as { code?: string };
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("auth/"))
      window.location.assign("/login");
    throw new ApiError(result.code ?? "REQUEST_FAILED", response.status);
  }
  return result as T;
}
export function queryString(values: Record<string, string | undefined>) {
  return new URLSearchParams(
    Object.entries(values).filter((e): e is [string, string] => !!e[1]),
  ).toString();
}
