import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UnirateClient } from "../src/client.js";
import { buildServer } from "../src/index.js";

const live = process.env.UNIRATE_LIVE === "1" && process.env.UNIRATE_API_KEY;
const d = live ? describe : describe.skip;

async function connect() {
  const apiKey = process.env.UNIRATE_API_KEY!;
  const unirate = new UnirateClient({ apiKey });
  const server = buildServer(unirate);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "live-test", version: "0.0.0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

d("live free-tier integration (requires UNIRATE_LIVE=1 + UNIRATE_API_KEY)", () => {
  it("convert USD→EUR returns a positive number", async () => {
    const client = await connect();
    const r = (await client.callTool({
      name: "convert",
      arguments: { from: "USD", to: "EUR", amount: 100 },
    })) as {
      isError?: boolean;
      structuredContent?: { result: number };
    };
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.result).toBeGreaterThan(0);
  });

  it("latest_rate USD→EUR returns plausible rate", async () => {
    const client = await connect();
    const r = (await client.callTool({
      name: "latest_rate",
      arguments: { from: "USD", to: "EUR" },
    })) as {
      isError?: boolean;
      structuredContent?: { rate: number };
    };
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.rate).toBeGreaterThan(0.5);
    expect(r.structuredContent?.rate).toBeLessThan(2);
  });

  it("list_currencies returns at least 100 codes including USD", async () => {
    const client = await connect();
    const r = (await client.callTool({
      name: "list_currencies",
      arguments: {},
    })) as {
      isError?: boolean;
      structuredContent?: { count: number; currencies: string[] };
    };
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.count).toBeGreaterThan(100);
    expect(r.structuredContent?.currencies).toContain("USD");
  });

  it("historical_rate on free-tier surfaces the Pro upgrade message", async () => {
    const client = await connect();
    const r = (await client.callTool({
      name: "historical_rate",
      arguments: { date: "2020-03-15", from: "USD", to: "EUR" },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0].text.toLowerCase()).toContain("pro");
  });
});
