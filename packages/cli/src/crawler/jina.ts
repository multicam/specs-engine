/**
 * Jina Reader client.
 *
 * GET https://r.jina.ai/<url> returns plain markdown prefixed with a
 * three-section header confirmed empirically on react.dev:
 *
 *   Title: <page title>
 *
 *   URL Source: <original URL>
 *
 *   Markdown Content:
 *   <body markdown ...>
 *
 * `fetchMarkdown` returns the parsed parts so callers can build their own
 * frontmatter. Errors (network / non-2xx / timeout) collapse into
 * `{status: "error", reason}` so the crawl loop can record the failure in
 * `_meta.json` and keep going.
 */

export interface JinaSuccess {
  status: "ok";
  title: string;
  urlSource: string;
  body: string;
}

export interface JinaFailure {
  status: "error";
  reason: string;
  /** HTTP status if the failure was a non-2xx response. */
  httpStatus?: number;
}

export type JinaResult = JinaSuccess | JinaFailure;

export interface JinaClientOptions {
  baseUrl: string;
  apiKeyEnv: string;
  timeoutMs: number;
  /** Override fetch for tests. Default is global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Override env source for tests. Default is `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Strip Jina's three-section header off the response body. Returns the
 * extracted parts; throws if the format doesn't match.
 *
 * Exported separately so tests can hit the parser without going through fetch.
 */
export function parseJinaResponse(text: string): {
  title: string;
  urlSource: string;
  body: string;
} {
  // Be lenient about whitespace between sections; Jina has historically used
  // single or double newlines between header lines.
  const titleMatch = text.match(/^Title:\s*(.*?)\s*\n/);
  const urlMatch = text.match(/\nURL Source:\s*(.*?)\s*\n/);
  const bodyIdx = text.indexOf("\nMarkdown Content:\n");
  if (!titleMatch || !urlMatch || bodyIdx === -1) {
    throw new Error(
      "jina: response did not match expected Title/URL Source/Markdown Content header layout",
    );
  }
  const body = text.slice(bodyIdx + "\nMarkdown Content:\n".length);
  return {
    title: titleMatch[1] ?? "",
    urlSource: urlMatch[1] ?? "",
    body,
  };
}

export interface JinaClient {
  fetchMarkdown(url: string): Promise<JinaResult>;
}

export function createJinaClient(opts: JinaClientOptions): JinaClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const apiKey = env[opts.apiKeyEnv];

  return {
    async fetchMarkdown(url: string): Promise<JinaResult> {
      const target = `${opts.baseUrl.replace(/\/+$/, "")}/${url}`;
      const headers: Record<string, string> = { Accept: "text/plain" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const res = await fetchImpl(target, { headers, signal: ctrl.signal });
        if (!res.ok) {
          return { status: "error", reason: `HTTP ${res.status}`, httpStatus: res.status };
        }
        const text = await res.text();
        const { title, urlSource, body } = parseJinaResponse(text);
        return { status: "ok", title, urlSource, body };
      } catch (err) {
        const reason =
          (err as Error).name === "AbortError"
            ? `timeout after ${opts.timeoutMs}ms`
            : (err as Error).message;
        return { status: "error", reason };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
