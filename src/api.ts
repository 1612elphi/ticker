// REST API — Hono routes

import { Hono } from 'hono';
import { buildReceipt, type ReceiptData } from './escpos.ts';
import { buildImagePrint, fetchImage } from './raster.ts';
import { print } from './printer.ts';

export const api = new Hono();

api.get('/', (c) => c.json({ name: 'ticker', status: 'ok' }));

api.post('/print/receipt', async (c) => {
  const body = await c.req.json<ReceiptData>();

  if (!body.lines || !Array.isArray(body.lines)) {
    return c.json({ error: 'lines array is required' }, 400);
  }

  const data = buildReceipt(body);
  await print(data);
  return c.json({ ok: true, bytes: data.length });
});

api.post('/print/raw', async (c) => {
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) {
    return c.json({ error: 'empty body' }, 400);
  }

  await print(Buffer.from(body));
  return c.json({ ok: true, bytes: body.byteLength });
});

api.post('/print/image', async (c) => {
  const body = await c.req.json<{
    url?: string;
    base64?: string;
    caption?: string;
    cut?: boolean;
  }>();

  let imageBuffer: Buffer;

  if (body.url) {
    imageBuffer = await fetchImage(body.url);
  } else if (body.base64) {
    imageBuffer = Buffer.from(body.base64, 'base64');
  } else {
    return c.json({ error: 'url or base64 is required' }, 400);
  }

  const data = await buildImagePrint(imageBuffer, {
    caption: body.caption,
    cut: body.cut,
  });

  await print(data);
  return c.json({ ok: true, bytes: data.length });
});
