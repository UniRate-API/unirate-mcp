import { afterEach, describe, expect, it } from "vitest";
import type { FetchLike } from "../src/client.js";
import { UnirateClient } from "../src/client.js";
import { startHttpServer } from "../src/index.js";

const mockFetch: FetchLike = async (url) => {
  if (/\/api\/convert\?/.test(url)) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: "92.50" }),
      json: async () => ({ result: "92.50" }),
    };
  }
  throw new Error(`no mock for url: ${url}`);
};

let activeClose: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (activeClose) {
    await activeClose();
    activeClose = null;
  }
});

describe("HTTP/SSE remote transport", () => {
  it("/healthz returns 200 with package metadata", async () => {
    const { port, close } = await startHttpServer(
      0,
      () => new UnirateClient({ apiKey: "k", fetchImpl: mockFetch }),
    );
    activeClose = close;

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; server: string };
    expect(body.status).toBe("ok");
    expect(body.server).toBe("unirate-mcp");
  });

  it("rejects unknown paths with 404", async () => {
    const { port, close } = await startHttpServer(
      0,
      () => new UnirateClient({ apiKey: "k", fetchImpl: mockFetch }),
    );
    activeClose = close;

    const res = await fetch(`http://127.0.0.1:${port}/not-mcp`);
    expect(res.status).toBe(404);
  });

  it("/mcp answers an MCP initialize handshake over HTTP", async () => {
    const { port, close } = await startHttpServer(
      0,
      () => new UnirateClient({ apiKey: "k", fetchImpl: mockFetch }),
    );
    activeClose = close;

    const initBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "0" },
      },
    };
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initBody),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    const text = await res.text();
    // Streamable HTTP can return either JSON or an SSE-framed response;
    // both forms must include the server-name in the initialize result.
    expect(text).toContain("unirate-mcp");
  });
});
