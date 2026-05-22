/**
 * GitHub API pagination with Link header parsing and ETag support.
 *
 * Invariants:
 *   - Follow Link: rel="next" headers for pagination
 *   - Store ETags for conditional requests on subsequent calls
 *   - Return merged results across all pages
 */


export interface PaginationResult<T> {
  items: T[];
  etag: string | null;
  nextUrl: string | null;
}

export function parseLinkHeader(linkHeader: string | null): {
  next?: string;
  prev?: string;
  first?: string;
  last?: string;
} {
  if (!linkHeader) {
    return {};
  }

  const links: Record<string, string> = {};
  const parts = linkHeader.split(",");

  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
    if (match) {
      links[match[2]] = match[1];
    }
  }

  return links;
}

export function getETag(response: Response): string | null {
  return response.headers.get("ETag");
}

export async function fetchPaginated<T>(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  initialUrl: string,
  init?: RequestInit,
): Promise<PaginationResult<T>> {
  const allItems: T[] = [];
  let currentUrl: string | null = initialUrl;
  let etag: string | null = null;

  while (currentUrl) {
    const response = await fetchFn(currentUrl, init);
    etag = getETag(response);

    const items = (await response.json()) as T[];
    allItems.push(...items);

    const linkHeader = response.headers.get("Link");
    const links = parseLinkHeader(linkHeader);
    currentUrl = links.next ?? null;
  }

  return { items: allItems, etag, nextUrl: null };
}

export async function fetchWithETag(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  etag: string | null,
  init?: RequestInit,
): Promise<{ response: Response; fromCache: boolean }> {
  const headers = new Headers(init?.headers);

  if (etag) {
    headers.set("If-None-Match", etag);
  }

  const response = await fetchFn(url, { ...init, headers });
  const fromCache = response.status === 304;

  return { response, fromCache };
}
