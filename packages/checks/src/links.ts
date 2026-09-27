import { request } from 'node:http';
import type { LinkCheck } from '@releasecheck/contracts';

// HEAD only, no cookies or redirect following. This runner accepts a controlled HTTP origin.
function probe(url: string, timeout: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const req = request(url, { method: 'HEAD', agent: false }, (response) => {
      response.destroy();
      resolve(response.statusCode);
      clearTimeout(timer);
    });
    const timer = setTimeout(() => req.destroy(new Error('Link timeout')), timeout);
    req.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    req.end();
  });
}

export async function checkLinks(
  hrefs: string[],
  pageUrl: string,
  origin: string,
  truncated = false,
): Promise<LinkCheck> {
  const selected = new Set<string>();
  let skipped = 0;
  for (const href of hrefs) {
    try {
      const url = new URL(href, pageUrl);
      if (
        !href.trim() ||
        href.startsWith('#') ||
        url.origin !== origin ||
        url.protocol !== 'http:' ||
        url.username ||
        url.password ||
        url.href.length > 2048
      ) {
        skipped++;
        continue;
      }
      if (url.hash && url.href.split('#')[0] === pageUrl.split('#')[0]) {
        skipped++;
        continue;
      }
      url.hash = '';
      selected.add(url.href);
    } catch {
      skipped++;
    }
  }
  const urls = [...selected];
  const results: LinkCheck['results'] = [];
  const deadline = Date.now() + 8000;
  for (const url of urls.slice(0, 20)) {
    const remaining = deadline - Date.now();
    const status = remaining > 0 ? await probe(url, Math.min(1000, remaining)) : undefined;
    results.push({
      url,
      status:
        status && status >= 200 && status < 300
          ? 'ok'
          : status && status >= 400 && status !== 405 && status !== 501
            ? 'broken'
            : 'unverified',
      ...(status ? { httpStatus: status } : {}),
    });
  }
  return { results, skipped, truncated: truncated || urls.length > 20 };
}
