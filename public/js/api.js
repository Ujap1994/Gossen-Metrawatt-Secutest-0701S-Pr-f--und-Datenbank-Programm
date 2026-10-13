// REST-Client
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let onLockedOut = null;
export function setLockedOutHandler(fn) {
  onLockedOut = fn;
}

export async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'secutest' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && data && data.code === 'LOCKED_OUT' && onLockedOut) onLockedOut();
    throw new ApiError((data && data.error) || `Fehler ${res.status}`, res.status, data);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
