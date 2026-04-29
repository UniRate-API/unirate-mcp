import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { FetchLike } from "../src/client.js";
import { UnirateClient } from "../src/client.js";
import { buildServer } from "../src/index.js";

type MockEntry = { match: RegExp; status: number; body: unknown };

function makeFetch(entries: MockEntry[]): FetchLike {
  return async (url) => {
    const hit = entries.find((e) => e.match.test(url));
    if (!hit) {
      throw new Error(`no mock for url: ${url}`);
    }
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      text: async () => (typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body)),
      json: async () => hit.body,
    };
  };
}

async function connectedClient(entries: MockEntry[]) {
  const unirate = new UnirateClient({ apiKey: "test-key", fetchImpl: makeFetch(entries) });
  const server = buildServer(unirate);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client };
}

describe("MCP server tool surface", () => {
  it("lists exactly the four advertised tools", async () => {
    const { client } = await connectedClient([]);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["convert", "historical_rate", "latest_rate", "list_currencies"]);
  });

  it("convert returns a human string + structured payload", async () => {
    const { client } = await connectedClient([
      { match: /\/api\/convert\?/, status: 200, body: { result: "92.50" } },
    ]);
    const result = (await client.callTool({
      name: "convert",
      arguments: { from: "usd", to: "eur", amount: 100 },
    })) as {
      content: Array<{ type: string; text: string }>;
      structuredContent?: { result: number; from: string; to: string };
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("100");
    expect(result.content[0].text).toContain("92.5");
    expect(result.content[0].text).toContain("USD");
    expect(result.content[0].text).toContain("EUR");
    expect(result.structuredContent?.result).toBeCloseTo(92.5);
  });

  it("latest_rate without `to` returns full table preview", async () => {
    const { client } = await connectedClient([
      {
        match: /\/api\/rates\?/,
        status: 200,
        body: { rates: { EUR: "0.92", GBP: "0.79", JPY: "150" } },
      },
    ]);
    const result = (await client.callTool({
      name: "latest_rate",
      arguments: { from: "USD" },
    })) as {
      content: Array<{ text: string }>;
      structuredContent?: { rates: Record<string, number> };
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("3 rates");
    expect(result.structuredContent?.rates.EUR).toBeCloseTo(0.92);
  });

  it("historical_rate on a free-tier key surfaces a helpful upgrade message", async () => {
    const { client } = await connectedClient([
      { match: /\/api\/historical\/rates\?/, status: 403, body: { error: "Pro required" } },
    ]);
    const result = (await client.callTool({
      name: "historical_rate",
      arguments: { date: "2020-03-15", from: "USD", to: "EUR" },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain("pro");
    expect(result.content[0].text).toContain("unirateapi.com");
  });

  it("list_currencies returns count + array", async () => {
    const { client } = await connectedClient([
      {
        match: /\/api\/currencies\?/,
        status: 200,
        body: { currencies: ["USD", "EUR", "GBP", "JPY"] },
      },
    ]);
    const result = (await client.callTool({
      name: "list_currencies",
      arguments: {},
    })) as {
      content: Array<{ text: string }>;
      structuredContent?: { count: number; currencies: string[] };
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.count).toBe(4);
    expect(result.structuredContent?.currencies).toContain("USD");
  });

  it("network failures bubble up as isError tool responses, not protocol errors", async () => {
    const failingFetch: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const unirate = new UnirateClient({ apiKey: "k", fetchImpl: failingFetch });
    const server = buildServer(unirate);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "t", version: "0" });
    await Promise.all([c.connect(ct), server.connect(st)]);

    const result = (await c.callTool({
      name: "convert",
      arguments: { from: "USD", to: "EUR", amount: 1 },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ECONNREFUSED");
  });

  it("invalid input (bad date format) is caught by zod schema validation, never reaches the API", async () => {
    const { client } = await connectedClient([]);
    const result = (await client.callTool({
      name: "historical_rate",
      arguments: { date: "not-a-date", from: "USD", to: "EUR" },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/date|YYYY-MM-DD|validation/i);
  });
});
