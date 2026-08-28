/** Shared transport for generated API calls. Generated files must not own auth or error behaviour. */
export type ApiErrorEnvelope = { error?: string; message?: string; details?: unknown };

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorEnvelope;
  constructor(status: number, body: ApiErrorEnvelope) {
    super(body.message || body.error || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const apiBase = import.meta.env.VITE_API_BASE || "/api";

export async function generatedFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const target = url.startsWith("http") ? url : `${apiBase}${url.replace(/^\/api/, "")}`;
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(target, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Something went wrong" })) as ApiErrorEnvelope;
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
