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
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

/** Fetch the synchronizer token once; the secret itself remains in an HttpOnly cookie. */
export async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfTokenPromise) {
    const endpoint = `${apiBase.replace(/\/$/, "")}/auth/csrf-token`;
    csrfTokenPromise = fetch(endpoint, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not obtain CSRF token (HTTP ${response.status})`);
        const body = await response.json() as { csrfToken?: unknown };
        if (typeof body.csrfToken !== "string" || body.csrfToken.length === 0) {
          throw new Error("CSRF token response was invalid");
        }
        csrfToken = body.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfTokenPromise = null;
      });
  }
  return csrfTokenPromise;
}

export async function generatedFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isApiRequest = !url.startsWith("http");
  const target = isApiRequest ? `${apiBase}${url.replace(/^\/api/, "")}` : url;
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const method = (options.method || "GET").toUpperCase();
  if (isApiRequest && unsafeMethods.has(method) && !headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", await ensureCsrfToken());
  }
  const response = await fetch(target, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Something went wrong" })) as ApiErrorEnvelope;
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return { data: undefined, status: response.status, headers: response.headers } as T;
  const data = await response.json();
  // Orval's fetch client models successful responses as a small envelope.
  // Keeping that envelope here gives every generated endpoint the same
  // status/header metadata without leaking transport details into features.
  return { data, status: response.status, headers: response.headers } as T;
}
