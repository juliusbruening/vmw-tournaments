// scraper/fetch.mjs
// Höfliches HTTP-Fetch mit User-Agent + simplem Retry.

const UA = 'VMW-Berlin-DC2026-Live/1.0 (Vereinsapp; +https://vmw-berlin.de)';

export async function fetchHtml(url, { retries = 2, timeoutMs = 15000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw new Error(`fetchHtml failed for ${url}: ${lastErr?.message ?? lastErr}`);
}
