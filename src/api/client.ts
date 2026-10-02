const BASE = '/api/v1';

function getToken(): string | null {
  return localStorage.getItem('pms_token');
}

export function setToken(token: string) {
  localStorage.setItem('pms_token', token);
}

export function clearToken() {
  localStorage.removeItem('pms_token');
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request(method: string, path: string, body?: any, options?: { headers?: Record<string, string> }) {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let fetchBody: any;
  if (body instanceof FormData) {
    // Don't set Content-Type for FormData — browser sets boundary automatically
    fetchBody = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  // Merge custom headers
  if (options?.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      if (k.toLowerCase() !== 'content-type' || !(body instanceof FormData)) {
        headers[k] = v;
      }
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: fetchBody
  });
  const data = await res.json();
  if (!data.success) throw { response: { data } };
  return data;
}

export const api = {
  get: (path: string, config?: { params?: Record<string, any> }) => {
    if (config?.params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(config.params)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      }
      const qstr = qs.toString();
      if (qstr) path = `${path}?${qstr}`;
    }
    return request('GET', path);
  },
  post: (path: string, body: any, options?: any) => request('POST', path, body, options),
  put: (path: string, body: any, options?: any) => request('PUT', path, body, options),
  patch: (path: string, body: any, options?: any) => request('PATCH', path, body, options),
  delete: (path: string, body?: any, options?: any) => request('DELETE', path, body, options),
  baseURL: BASE,
};
