/**
 * AlgoVault MCP Server - Streamable HTTP endpoint
 */

import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authenticateWithScope, type VerifiedApiKey } from "@/lib/intelligence-cloud/api-keys";
import { readBearerToken } from "@/lib/intelligence-cloud/route";
import { z } from "zod";

export const dynamic = "force-dynamic";

async function authenticateMCP(request: NextRequest): Promise<VerifiedApiKey | NextResponse> {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized", message: "API key required via Authorization: Bearer <key>" },
      { status: 401 }
    );
  }

  try {
    const key = await authenticateWithScope(token, "market:read");
    return key;
  } catch (error: any) {
    return NextResponse.json(
      { error: "Unauthorized", message: error.message || "Invalid API key" },
      { status: 401 }
    );
  }
}

function createMcpServer() {
  const server = new McpServer({
    name: "algovault-mcp",
    version: "0.1.0",
  }, {
    capabilities: {
      tools: {},
    },
  });

  server.tool(
    "get_market_data",
    "Get current market data for a symbol",
    {
      symbol: z.string().describe("Trading symbol (e.g., EURUSD)"),
      timeframe: z.string().optional().describe("Timeframe (e.g., 1H, 4H, 1D)"),
    },
    async ({ symbol, timeframe }) => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/v1/market?symbol=${encodeURIComponent(symbol)}${timeframe ? `&timeframe=${encodeURIComponent(timeframe)}` : ""}`);
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new Error(`Failed to fetch market data: ${error.message}`);
      }
    }
  );

  server.tool(
    "get_market_graph",
    "Get market graph structure for a symbol",
    {
      symbol: z.string().describe("Trading symbol"),
    },
    async ({ symbol }) => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/v1/market/graph?symbol=${encodeURIComponent(symbol)}`);
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new Error(`Failed to fetch market graph: ${error.message}`);
      }
    }
  );

  server.tool(
    "get_indicators",
    "Get technical indicators for a symbol",
    {
      symbol: z.string().describe("Trading symbol"),
      timeframe: z.string().optional().describe("Timeframe"),
    },
    async ({ symbol, timeframe }) => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/v1/indicators?symbol=${encodeURIComponent(symbol)}${timeframe ? `&timeframe=${encodeURIComponent(timeframe)}` : ""}`);
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new Error(`Failed to fetch indicators: ${error.message}`);
      }
    }
  );

  server.tool(
    "get_analytics",
    "Get analytics data",
    {
      symbol: z.string().optional().describe("Trading symbol (optional)"),
    },
    async ({ symbol }) => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/v1/analytics${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`);
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new Error(`Failed to fetch analytics: ${error.message}`);
      }
    }
  );

  server.tool(
    "get_smart_money",
    "Get Smart Money analysis for a symbol",
    {
      symbol: z.string().describe("Trading symbol"),
    },
    async ({ symbol }) => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/v1/smart-money?symbol=${encodeURIComponent(symbol)}`);
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new Error(`Failed to fetch smart money data: ${error.message}`);
      }
    }
  );

  server.tool(
    "list_research_jobs",
    "List research jobs",
    {},
    async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/v1/research`);
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new Error(`Failed to list research jobs: ${error.message}`);
      }
    }
  );

  server.tool(
    "get_research_job",
    "Get a research job by ID",
    {
      jobId: z.string().describe("Research job ID"),
    },
    async ({ jobId }) => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/v1/research/${encodeURIComponent(jobId)}`);
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new Error(`Failed to get research job: ${error.message}`);
      }
    }
  );

  server.tool(
    "validate_strategy",
    "Validate a trading strategy",
    {
      symbol: z.string().describe("Trading symbol"),
      timeframe: z.string().optional().describe("Timeframe"),
      rules: z.any().optional().describe("Strategy rules"),
    },
    async ({ symbol, timeframe, rules }) => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(`${baseUrl}/api/v1/strategies/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, timeframe, rules }),
        });
        const data = await res.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error: any) {
        throw new Error(`Failed to validate strategy: ${error.message}`);
      }
    }
  );

  return server;
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateMCP(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return response;
  } catch (error: any) {
    console.error("MCP server error:", error);
    return NextResponse.json(
      { error: "Internal server error", message: "MCP request failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ message: "AlgoVault MCP Server - use POST for MCP requests" });
}
