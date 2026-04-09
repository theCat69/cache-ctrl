export interface FreshnessCheckInput {
  url: string;
  etag?: string;
  last_modified?: string;
}

export interface FreshnessCheckOutput {
  url: string;
  status: "fresh" | "stale" | "error";
  http_status?: number;
  etag?: string;
  last_modified?: string;
  error?: string;
}

/**
 * RFC-1918 / loopback / link-local / ULA / mapped-IPv6 IP pattern.
 * Blocks raw IP literals only — does NOT do DNS resolution.
 *
 * Covers:
 *   - 127.x          loopback IPv4
 *   - ::1            loopback IPv6
 *   - localhost      loopback hostname
 *   - 10.x           RFC-1918 class A
 *   - 169.254.x      link-local IPv4
 *   - 172.16–31.x    RFC-1918 class B
 *   - 192.168.x      RFC-1918 class C
 *   - 0.0.0.0        unspecified IPv4
 *   - fc00::/7       RFC-4193 unique-local IPv6 (ULA — fc or fd followed by hex digits and colon)
 *   - ::ffff:        IPv4-mapped IPv6
 */
const PRIVATE_IP_PATTERN =
  /^(127\.|::1$|localhost$|10\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0$|::ffff:|f[cd][0-9a-f]{0,2}:)/i;

function isAllowedUrl(url: string): { allowed: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { allowed: false, reason: `Disallowed URL scheme — only http and https are permitted: ${url}` };
    }
    if (PRIVATE_IP_PATTERN.test(parsed.hostname)) {
      return { allowed: false, reason: `Requests to private/loopback addresses are not permitted: ${url}` };
    }
    return { allowed: true };
  } catch {
    return { allowed: false, reason: `Invalid URL: ${url}` };
  }
}

export async function checkFreshness(input: FreshnessCheckInput): Promise<FreshnessCheckOutput> {
  const allowCheck = isAllowedUrl(input.url);
  if (!allowCheck.allowed) {
    return {
      url: input.url,
      status: "error",
      error: allowCheck.reason,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const headers: Record<string, string> = {};
    if (input.etag) {
      headers["If-None-Match"] = input.etag;
    }
    if (input.last_modified) {
      headers["If-Modified-Since"] = input.last_modified;
    }

    const response = await fetch(input.url, {
      method: "HEAD",
      headers,
      signal: controller.signal,
    });

    if (response.status === 304) {
      return {
        url: input.url,
        status: "fresh",
        http_status: 304,
      };
    }

    if (response.status === 200) {
      const etag = response.headers.get("etag") ?? undefined;
      const lastModified = response.headers.get("last-modified") ?? undefined;
      return {
        url: input.url,
        status: "stale",
        http_status: 200,
        etag,
        last_modified: lastModified,
      };
    }

    // 4xx/5xx
    return {
      url: input.url,
      status: "error",
      http_status: response.status,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (err) {
    const error = err as Error;
    return {
      url: input.url,
      status: "error",
      error: error.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
