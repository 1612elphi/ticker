// Convert images to 1-bit ESC/POS raster data for the TM-T20II (576 dots wide)

import sharp from 'sharp';
import { init, align, Align, rasterImage, text, newline, cut as cutCmd } from './escpos.ts';

const PRINTER_WIDTH_PX = 576;

export interface ImagePrintOptions {
  caption?: string;
  cut?: boolean;
}

export async function buildImagePrint(input: Buffer, options: ImagePrintOptions = {}): Promise<Buffer> {
  // Resize to printer width, convert to 1-bit
  const resized = sharp(input)
    .resize(PRINTER_WIDTH_PX, undefined, { fit: 'inside' })
    .grayscale()
    .threshold(128);

  const { data, info } = await resized
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const widthBytes = Math.ceil(width / 8);

  // Pack into 1-bit MSB-first (black = 1)
  const rasterData = Buffer.alloc(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = data[y * width + x];
      // Threshold already applied, so 0 = black, 255 = white
      // ESC/POS: 1 = black dot
      if (pixel === 0) {
        const byteIndex = y * widthBytes + Math.floor(x / 8);
        const bitIndex = 7 - (x % 8);
        rasterData[byteIndex] |= (1 << bitIndex);
      }
    }
  }

  const parts: Buffer[] = [
    init(),
    align(Align.CENTER),
    newline(),
    rasterImage(rasterData, widthBytes, height),
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

export async function fetchImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
