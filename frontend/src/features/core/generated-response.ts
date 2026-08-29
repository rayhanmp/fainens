/**
 * Unwrap a generated-client response at a feature boundary.
 *
 * Orval deliberately returns a discriminated union for every declared HTTP
 * status. Keeping the status check here prevents individual hooks from
 * silently accepting an error envelope as server data while still preserving
 * the generated response types at the transport boundary.
 */
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

