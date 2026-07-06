export function parseJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const parsed: unknown = await response.json();
  return parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
