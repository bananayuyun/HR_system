const BASE = import.meta.env.VITE_API_BASE || '/api';
let csrfToken = '';
export function setCsrfToken(value) {
  csrfToken = value || '';
}
export async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = {
    Accept: 'application/json',
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };
  if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;
  const response = await fetch(BASE + path, {
    credentials: 'include',
    ...options,
    headers,
    body:
      options.body === undefined ? undefined : isForm ? options.body : JSON.stringify(options.body),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('hr:unauthorized'));
    const error = new Error(
      data?.message ||
        data?.error?.message ||
        (response.status === 403 ? '当前账号无权执行此操作。' : `请求失败（${response.status}）`),
    );
    error.status = response.status;
    error.details = data;
    throw error;
  }
  if (data?.csrfToken) setCsrfToken(data.csrfToken);
  return data?.data !== undefined && !Array.isArray(data) ? data.data : data;
}
export async function downloadFile(path, name) {
  const url = URL.createObjectURL(await fileBlob(path));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function fileBlob(path) {
  const response = await fetch(BASE + path, { credentials: 'include' });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('hr:unauthorized'));
    throw new Error('文件读取失败或没有访问权限。');
  }
  return response.blob();
}
