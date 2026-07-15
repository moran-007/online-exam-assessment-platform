type GeneratedResponse<T> = { data: T };

export async function generatedData<T>(request: Promise<GeneratedResponse<T>>): Promise<T> {
  const payload = (await request).data as T | { code: number; message: string; data: T };
  if (payload && typeof payload === 'object' && 'code' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload as T;
}

export function asGenerated<T>(request: Promise<unknown>): Promise<GeneratedResponse<T>> {
  return request as Promise<GeneratedResponse<T>>;
}
