// Convert images to 1-bit ESC/POS raster data for the TM-T20II (576 dots wide)

import sharp from 'sharp';
import { init, align, Align, rasterImage, text, newline, cut as cutCmd } from './escpos.ts';

const PRINTER_WIDTH_PX = 576;

// Shared 1-bit raster packer — converts grayscale pixels to MSB-first bit-packed buffer
export function packRaster(
  pixels: Buffer, width: number, height: number,
  threshold = 128,
): { rasterData: Buffer; widthBytes: number } {
  const widthBytes = Math.ceil(width / 8);
  const rasterData = Buffer.alloc(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] < threshold) {
        rasterData[y * widthBytes + Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
      }
    }
  }

  return { rasterData, widthBytes };
}

export interface ImagePrintOptions {
  caption?: string;
  cut?: boolean;
}

export async function buildImagePrint(input: Buffer, options: ImagePrintOptions = {}): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .resize(PRINTER_WIDTH_PX, undefined, { fit: 'inside' })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { rasterData, widthBytes } = packRaster(data, info.width, info.height, 128);

  const parts: Buffer[] = [
    init(),
    align(Align.CENTER),
    newline(),
    rasterImage(rasterData, widthBytes, info.height),
    newline(),
  ];

  if (options.caption) {
    parts.push(align(Align.CENTER), text(options.caption), newline());
  }

  if (options.cut !== false) {
    parts.push(cutCmd());
  }

  return Buffer.concat(parts);
}

// Validate URL to prevent SSRF — only allow http(s) and reject private/internal IPs
function isAllowedUrl(urlStr: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname;
  // Block localhost
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  // Block link-local and metadata endpoints
  if (host.startsWith('169.254.') || host === '169.254.169.254') return false;
  // Block RFC 1918 private ranges
  if (host.startsWith('10.') || host.startsWith('192.168.')) return false;
  if (host.match(/^172\.(1[6-9]|2\d|3[01])\./)) return false;
  // Block 0.0.0.0
  if (host === '0.0.0.0') return false;

  return true;
}

export async function fetchImage(url: string): Promise<Buffer> {
  if (!isAllowedUrl(url)) throw new Error('URL not allowed: must be public http(s)');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// Shared image resolver — handles url vs base64 input
export async function resolveImage(input: { url?: string; base64?: string }): Promise<Buffer> {
  if (input.url) return fetchImage(input.url);
  if (input.base64) return Buffer.from(input.base64, 'base64');
  throw new Error('url or base64 is required');
}
