import { useCallback, useEffect, useState } from 'react';

export async function api<T>(
  url: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((error) => {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Could not connect to the application.');
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== '/auth/login')
    window.dispatchEvent(new Event('session-expired'));
  if (!response.ok) throw new Error(data.error ?? 'Could not connect to the application.');
  return data as T;
}

export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    setData(null);
  }, [url]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api<T>(url, 'GET', undefined, controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [url, version]);
  useEffect(() => {
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { data, error, refresh };
}
