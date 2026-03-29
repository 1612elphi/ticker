// ESC/POS command builder for Epson TM-T20II

const ESC = 0x1b;
const GS = 0x1d;

export const Align = { LEFT: 0, CENTER: 1, RIGHT: 2 } as const;
export type AlignValue = (typeof Align)[keyof typeof Align];

export function init(): Buffer {
  return Buffer.from([
    ESC, 0x40,       // ESC @ — initialize
    ESC, 0x52, 0x00, // ESC R 0 — USA international charset (tilde fix)
    ESC, 0x74, 0x00, // ESC t 0 — PC437 code page
  ]);
}

export function align(a: AlignValue): Buffer {
  return Buffer.from([ESC, 0x61, a]);
}

export function bold(on: boolean): Buffer {
  return Buffer.from([ESC, 0x45, on ? 1 : 0]);
}

export function doubleSize(on: boolean): Buffer {
  // ESC ! n — bit 4 = double height, bit 5 = double width
  return Buffer.from([ESC, 0x21, on ? 0x30 : 0x00]);
}

export function text(str: string): Buffer {
  return Buffer.from(str, 'ascii');
}

export function newline(count = 1): Buffer {
  return Buffer.from('\n'.repeat(count));
}

export function separator(char = '=', width = 48): Buffer {
  return Buffer.from(char.repeat(width) + '\n');
}

export function cut(): Buffer {
  return Buffer.from([
    ...newline(3),
    GS, 0x56, 0x00, // GS V 0 — full cut
  ]);
}

export function rasterImage(imageData: Buffer, widthBytes: number, height: number): Buffer {
  // GS v 0 m xL xH yL yH [data]
  const header = Buffer.from([
    GS, 0x76, 0x30, 0x00,        // GS v 0, m=0 (normal)
    widthBytes & 0xff,             // xL
    (widthBytes >> 8) & 0xff,      // xH
    height & 0xff,                 // yL
    (height >> 8) & 0xff,          // yH
  ]);
  return Buffer.concat([header, imageData]);
}

// Build a complete receipt from structured data
export interface ReceiptData {
  title?: string;
  lines: string[];
  footer?: string;
  align?: 'left' | 'center' | 'right';
  cut?: boolean;
}

const alignMap = { left: Align.LEFT, center: Align.CENTER, right: Align.RIGHT } as const;

export function buildReceipt(data: ReceiptData): Buffer {
  const parts: Buffer[] = [init()];
  const defaultAlign = alignMap[data.align ?? 'left'];

  if (data.title) {
    parts.push(align(Align.CENTER), bold(true), doubleSize(true));
    parts.push(text(data.title), newline());
    parts.push(doubleSize(false), bold(false), newline());
  }

  parts.push(align(defaultAlign));

  for (const line of data.lines) {
    if (line === '---') {
      parts.push(separator('-'));
    } else if (line === '===') {
      parts.push(separator('='));
    } else {
      parts.push(text(line), newline());
    }
  }

  if (data.footer) {
    parts.push(newline(), align(Align.CENTER));
    parts.push(separator());
    parts.push(text(data.footer), newline());
    parts.push(separator());
  }

  if (data.cut !== false) {
    parts.push(cut());
  }

  return Buffer.concat(parts);
}
