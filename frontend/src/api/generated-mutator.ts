import { apiWire } from '../api';

export async function apiMutator<T>(url: string, options: RequestInit): Promise<T> {
  const payload = await apiWire(url, options) as unknown;
  const wire = payload && typeof payload === 'object' ? payload as { data?: unknown; status?: number; headers?: Headers } : null;
  const isBinaryWireResponse = Boolean(wire?.headers && wire?.status && !('code' in (payload as object)));

  return {
    data: isBinaryWireResponse ? wire?.data : payload,
    status: wire?.status ?? (options.method === 'POST' ? 201 : 200),
    headers: wire?.headers ?? new Headers(),
  } as T;
}
