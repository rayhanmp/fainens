/**
 * Unwrap a generated-client response at a feature boundary.
 *
 * Orval deliberately returns a discriminated union for every declared HTTP
 * status. Keeping the status check here prevents individual hooks from
 * silently accepting an error envelope as server data while still preserving
 * the generated response types at the transport boundary.
 */
type DataForStatus<T, S extends number> = Extract<T, { status: S }> extends { data: infer D } ? D : never;

/** Convert API date values into the numeric timestamps used by the UI. */
export function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function unwrapGenerated<T extends { status: number; data: unknown }, S extends number>(
  request: Promise<T>,
  expectedStatus: S,
  message: string,
): Promise<DataForStatus<T, S>>;

export function unwrapGenerated<T extends { status: number; data: unknown }, S extends readonly number[]>(
  request: Promise<T>,
  expectedStatus: S,
  message: string,
): Promise<DataForStatus<T, S[number]>>;

export async function unwrapGenerated<T extends { status: number; data: unknown }>(
  request: Promise<T>,
  expectedStatus: number | readonly number[],
  message: string,
): Promise<T['data']> {
  const response = await request;
  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(response.status)) {
    throw new Error(message);
  }
  return response.data;
}
