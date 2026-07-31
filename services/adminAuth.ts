export const withAdminHeaders = (headers: HeadersInit = {}): HeadersInit => headers;

export const adminFetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  return fetch(input, {
    ...init,
    headers: withAdminHeaders(init.headers),
  });
};
