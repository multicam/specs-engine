import { describe, test, expect } from "bun:test";
import { createFrontier } from "../src/crawler/frontier.ts";

describe("frontier", () => {
  test("dedupes across canonical variants", () => {
    const f = createFrontier({ maxDepth: 5, maxPages: 100 });
    expect(f.enqueue("https://x.example/docs", 0)).toBe(true);
    expect(f.enqueue("https://X.EXAMPLE/docs/", 1)).toBe(false);
    expect(f.enqueue("https://x.example/docs?ref=nav", 1)).toBe(false);
    expect(f.enqueue("https://x.example/docs#frag", 1)).toBe(false);
    expect(f.visitedCount()).toBe(1);
  });

  test("stops enqueuing past max_depth", () => {
    const f = createFrontier({ maxDepth: 2, maxPages: 100 });
    expect(f.enqueue("https://x.example/a", 0)).toBe(true);
    expect(f.enqueue("https://x.example/b", 2)).toBe(true);
    expect(f.enqueue("https://x.example/c", 3)).toBe(false);
    expect(f.visitedCount()).toBe(2);
  });

  test("take() returns null after max_pages dispatched", () => {
    const f = createFrontier({ maxDepth: 5, maxPages: 2 });
    f.enqueue("https://x.example/a", 0);
    f.enqueue("https://x.example/b", 0);
    f.enqueue("https://x.example/c", 0);
    expect(f.take()?.url).toBe("https://x.example/a");
    expect(f.take()?.url).toBe("https://x.example/b");
    expect(f.take()).toBeNull();
    expect(f.takenCount()).toBe(2);
  });

  test("take() returns null when queue empty", () => {
    const f = createFrontier({ maxDepth: 5, maxPages: 100 });
    expect(f.take()).toBeNull();
  });

  test("rejects malformed URLs", () => {
    const f = createFrontier({ maxDepth: 5, maxPages: 100 });
    expect(f.enqueue("not a url", 0)).toBe(false);
    expect(f.enqueue("javascript:void(0)", 0)).toBe(false);
    expect(f.visitedCount()).toBe(0);
  });

  test("BFS order: depth-0 items dequeued before depth-1", () => {
    const f = createFrontier({ maxDepth: 5, maxPages: 100 });
    f.enqueue("https://x.example/root1", 0);
    f.enqueue("https://x.example/root2", 0);
    f.enqueue("https://x.example/child", 1);
    expect(f.take()?.url).toBe("https://x.example/root1");
    expect(f.take()?.url).toBe("https://x.example/root2");
    expect(f.take()?.url).toBe("https://x.example/child");
  });
});
