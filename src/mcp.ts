// MCP server — Streamable HTTP transport (web standard)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { buildReceipt } from './escpos.ts';
import { buildImagePrint, resolveImage } from './raster.ts';
import { buildSessionReceipt } from './session.ts';
import { print } from './printer.ts';
import type { Context } from 'hono';

function createServer(): McpServer {
  const server = new McpServer({
    name: 'ticker',
    version: '1.0.0',
  });

  server.tool(
    'print_receipt',
    'Print a structured receipt with optional title, lines of text, and footer. Use "---" or "===" in lines for separator rules.',
    {
      title: z.string().optional().describe('Bold, large title at the top'),
      lines: z.array(z.string()).describe('Lines of text. Use "---" for a dashed separator, "===" for a double separator.'),
      footer: z.string().optional().describe('Small centered footer text'),
      align: z.enum(['left', 'center', 'right']).optional().describe('Default text alignment'),
      cut: z.boolean().optional().describe('Cut paper after printing (default true)'),
    },
    async (params) => {
      const data = buildReceipt(params);
      await print(data);
      return { content: [{ type: 'text', text: `Printed ${data.length} bytes` }] };
    }
  );

  server.tool(
    'print_raw',
    'Send raw ESC/POS binary data to the printer (base64 encoded)',
    {
      data: z.string().describe('Base64-encoded ESC/POS binary data'),
    },
    async ({ data }) => {
      const buf = Buffer.from(data, 'base64');
      await print(buf);
      return { content: [{ type: 'text', text: `Printed ${buf.length} raw bytes` }] };
    }
  );

  server.tool(
    'print_image',
    'Print an image on the receipt printer. Accepts a URL or base64 data. The image is automatically resized and dithered for thermal printing.',
    {
      url: z.string().optional().describe('URL of the image to print'),
      base64: z.string().optional().describe('Base64-encoded image data'),
      caption: z.string().optional().describe('Text caption below the image'),
      cut: z.boolean().optional().describe('Cut paper after printing (default true)'),
    },
    async (params) => {
      const imageBuffer = await resolveImage(params);
      const data = await buildImagePrint(imageBuffer, { caption: params.caption, cut: params.cut });
      await print(data);
      return { content: [{ type: 'text', text: `Printed image (${data.length} bytes)` }] };
    }
  );

  const fileChangeSchema = z.object({
    status: z.enum(['A', 'M', 'D', 'R']).describe('A=added, M=modified, D=deleted, R=renamed'),
    path: z.string().describe('File path relative to project root'),
  });

  const reviewSchema = z.object({
    score: z.number().min(0).max(10).describe('Code review score 0-10'),
    testsTotal: z.number().optional().describe('Total number of tests'),
    testsPassing: z.number().optional().describe('Number of passing tests'),
    typeErrors: z.boolean().optional().describe('Whether type errors exist'),
    notes: z.array(z.string()).optional().describe('Review notes/observations'),
  });

  server.tool(
    'print_session',
    'Print a Claude Code session summary receipt with conversation stats, token usage, files changed, summary, and code review score.',
    {
      project: z.string().optional().describe('Project name'),
      date: z.string().optional().describe('Session date (e.g. 2026-03-29)'),
      startTime: z.string().optional().describe('Session start time (e.g. 14:32)'),
      endTime: z.string().optional().describe('Session end time (e.g. 15:47)'),
      duration: z.string().optional().describe('Session duration (e.g. 1h 15m)'),
      model: z.string().optional().describe('Model used (e.g. claude-opus-4-6)'),
      messages: z.number().optional().describe('Total messages in conversation'),
      humanTurns: z.number().optional().describe('Number of human turns'),
      toolCalls: z.number().optional().describe('Total tool calls made'),
      tokensIn: z.number().optional().describe('Input tokens'),
      tokensOut: z.number().optional().describe('Output tokens'),
      cacheRead: z.number().optional().describe('Cache read tokens'),
      cacheWrite: z.number().optional().describe('Cache write tokens'),
      cost: z.string().optional().describe('Cost string (e.g. "$0.00 (subscription)")'),
      files: z.array(fileChangeSchema).optional().describe('Files changed'),
      summary: z.string().optional().describe('Summary of what was accomplished'),
      review: reviewSchema.optional().describe('Code review results'),
    },
    async (params) => {
      const data = await buildSessionReceipt(params);
      await print(data);
      return { content: [{ type: 'text', text: `Printed session receipt (${data.length} bytes)` }] };
    }
  );

  return server;
}

// Session management with TTL eviction
interface Session {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  lastSeen: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastSeen > SESSION_TTL_MS) {
      session.transport.close();
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000); // sweep every 5 minutes

export async function handleMcp(c: Context): Promise<Response> {
  const sessionId = c.req.header('mcp-session-id');

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastSeen = Date.now();
    return session.transport.handleRequest(c.req.raw);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport, lastSeen: Date.now() });
    },
  });

  const server = createServer();
  await server.connect(transport);

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  return transport.handleRequest(c.req.raw);
}
