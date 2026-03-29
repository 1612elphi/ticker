// MCP server — Streamable HTTP transport (web standard), three tools mirroring the REST API

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { buildReceipt } from './escpos.ts';
import { buildImagePrint, fetchImage } from './raster.ts';
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
      let imageBuffer: Buffer;

      if (params.url) {
        imageBuffer = await fetchImage(params.url);
      } else if (params.base64) {
        imageBuffer = Buffer.from(params.base64, 'base64');
      } else {
        return { content: [{ type: 'text', text: 'Error: url or base64 is required' }], isError: true };
      }

      const data = await buildImagePrint(imageBuffer, {
        caption: params.caption,
        cut: params.cut,
      });

      await print(data);
      return { content: [{ type: 'text', text: `Printed image (${data.length} bytes)` }] };
    }
  );

  return server;
}

// Stateful: one transport per session, server per session
const sessions = new Map<string, { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }>();

export async function handleMcp(c: Context): Promise<Response> {
  const sessionId = c.req.header('mcp-session-id');

  // Existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    return session.transport.handleRequest(c.req.raw);
  }

  // New session (initialization)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { server, transport });
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
