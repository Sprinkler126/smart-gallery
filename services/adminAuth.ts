const ADMIN_TOKEN_STORAGE_KEY = 'smartGalleryAdminToken';

export const getAdminToken = (): string => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
};

export const setAdminToken = (token: string): void => {
  if (typeof window === 'undefined') return;
  const trimmed = token.trim();
  if (trimmed) {
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  }
};

export const withAdminHeaders = (headers: HeadersInit = {}): HeadersInit => {
  const token = getAdminToken();
  return token
    ? { ...headers, 'X-Admin-Token': token }
    : headers;
};

export const adminFetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  return fetch(input, {
    ...init,
    headers: withAdminHeaders(init.headers),
  });
};
