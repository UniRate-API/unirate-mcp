/**
 * Standalone example: spin up the UniRate MCP server and call its tools
 * directly using an in-process MCP client. Useful for prototyping outside
 * an LLM host.
 *
 * Run: UNIRATE_API_KEY=... npx tsx examples/standalone_client.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UnirateClient } from "../src/client.js";
import { buildServer } from "../src/index.js";

async function main(): Promise<void> {
  const apiKey = process.env.UNIRATE_API_KEY;
  if (!apiKey) {
    console.error("Set UNIRATE_API_KEY in your environment.");
    process.exit(1);
  }

  const unirate = new UnirateClient({ apiKey });
  const server = buildServer(unirate);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "example-client", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  console.log("=== Tools ===");
  const { tools } = await client.listTools();
  for (const t of tools) console.log(`- ${t.name}: ${t.description?.split(".")[0]}`);

  console.log("\n=== convert 100 USD → EUR ===");
  console.log(
    await client.callTool({
      name: "convert",
      arguments: { from: "USD", to: "EUR", amount: 100 },
    }),
  );

  console.log("\n=== latest_rate USD → JPY ===");
  console.log(
    await client.callTool({
      name: "latest_rate",
      arguments: { from: "USD", to: "JPY" },
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
