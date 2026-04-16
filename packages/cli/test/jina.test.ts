import { describe, test, expect } from "bun:test";
import { createJinaClient, parseJinaResponse } from "../src/crawler/jina.ts";

const SAMPLE = `Title: React – A JavaScript library for building user interfaces

URL Source: https://react.dev/

Markdown Content:
# React

The library for web and native user interfaces.

[Get started](https://react.dev/learn)
`;

interface FactoryOpts {
  baseUrl?: string;
  env?: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
}

/** Build a client with the test defaults; only override what each test needs. */
function makeClient(opts: FactoryOpts) {
  return createJinaClient({
    baseUrl: opts.baseUrl ?? "https://r.jina.ai",
    apiKeyEnv: "JINA_API_KEY",
    timeoutMs: 5000,
    env: opts.env ?? {},
    fetchImpl: opts.fetchImpl,
  });
}

/** Builds a fetch mock that records request URLs and returns SAMPLE for each call. */
function recordingFetch(): { calls: string[]; fetchImpl: typeof fetch } {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(typeof input === "string" ? input : input.toString());
    return new Response(SAMPLE, { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** Builds a fetch mock that captures request headers from the first call. */
function capturingFetch(): {
  captured: { headers?: Headers };
  fetchImpl: typeof fetch;
} {
  const captured: { headers?: Headers } = {};
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    captured.headers = new Headers(init.headers);
    return new Response(SAMPLE, { status: 200 });
  }) as unknown as typeof fetch;
  return { captured, fetchImpl };
}

describe("parseJinaResponse", () => {
  test("extracts title, urlSource, and body", () => {
    const r = parseJinaResponse(SAMPLE);
    expect(r.title).toBe("React – A JavaScript library for building user interfaces");
    expect(r.urlSource).toBe("https://react.dev/");
    expect(r.body.startsWith("# React")).toBe(true);
    expect(r.body.includes("Get started")).toBe(true);
  });

  test("body excludes the header lines", () => {
    const r = parseJinaResponse(SAMPLE);
    expect(r.body.includes("Title:")).toBe(false);
    expect(r.body.includes("URL Source:")).toBe(false);
    expect(r.body.includes("Markdown Content:")).toBe(false);
  });

  test("throws on malformed response (missing markers)", () => {
    expect(() => parseJinaResponse("just some markdown\n")).toThrow(/expected/);
  });
});

describe("createJinaClient", () => {
  test("hits the correct URL and parses success", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const r = await makeClient({ fetchImpl }).fetchMarkdown("https://react.dev/");
    expect(calls).toEqual(["https://r.jina.ai/https://react.dev/"]);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.title.startsWith("React")).toBe(true);
      expect(r.urlSource).toBe("https://react.dev/");
    }
  });

  test("adds Authorization header when JINA_API_KEY env var present", async () => {
    const { captured, fetchImpl } = capturingFetch();
    await makeClient({ env: { JINA_API_KEY: "secret-token" }, fetchImpl })
      .fetchMarkdown("https://react.dev/");
    expect(captured.headers?.get("Authorization")).toBe("Bearer secret-token");
  });

  test("omits Authorization header when env var absent", async () => {
    const { captured, fetchImpl } = capturingFetch();
    await makeClient({ fetchImpl }).fetchMarkdown("https://react.dev/");
    expect(captured.headers?.get("Authorization")).toBeNull();
  });

  test("returns error on non-2xx", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const r = await makeClient({ fetchImpl }).fetchMarkdown("https://react.dev/");
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.httpStatus).toBe(503);
      expect(r.reason).toMatch(/503/);
    }
  });

  test("returns error on fetch throwing", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await makeClient({ fetchImpl }).fetchMarkdown("https://react.dev/");
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.reason).toMatch(/network down/);
  });

  test("strips trailing slash on base URL", async () => {
    const { calls, fetchImpl } = recordingFetch();
    await makeClient({ baseUrl: "https://r.jina.ai///", fetchImpl })
      .fetchMarkdown("https://react.dev/");
    expect(calls[0]).toBe("https://r.jina.ai/https://react.dev/");
  });
});
