// Claude Code session receipt builder with box drawing layout

import {
  init, align, Align, bold, doubleSize, text, newline,
  rasterImage, cut,
} from './escpos.ts';
import { getLogoBuffer } from './logo.ts';
import sharp from 'sharp';

const W = 48; // receipt character width (inner width = W - 2 for box borders)
const IW = W - 2; // inner width between box walls

// PC437 box drawing bytes
const BOX = {
  TL: 0xc9,  // ╔
  TR: 0xbb,  // ╗
  BL: 0xc8,  // ╚
  BR: 0xbc,  // ╝
  H:  0xcd,  // ═
  V:  0xba,  // ║
  LT: 0xcc,  // ╠
  RT: 0xb9,  // ╣
  sH:  0xc4, // ─
} as const;

function topBorder(): Buffer {
  return Buffer.from([BOX.TL, ...Array(IW).fill(BOX.H), BOX.TR, 0x0a]);
}

function bottomBorder(): Buffer {
  return Buffer.from([BOX.BL, ...Array(IW).fill(BOX.H), BOX.BR, 0x0a]);
}

function sectionDivider(): Buffer {
  return Buffer.from([BOX.LT, ...Array(IW).fill(BOX.H), BOX.RT, 0x0a]);
}

function thinDivider(): Buffer {
  return Buffer.from([BOX.V, ...Array(IW).fill(BOX.sH), BOX.V, 0x0a]);
}

function boxLine(content: string, centered = false): Buffer {
  let inner: string;
  if (centered) {
    const pad = Math.max(0, IW - content.length);
    const left = Math.floor(pad / 2);
    const right = pad - left;
    inner = ' '.repeat(left) + content + ' '.repeat(right);
  } else {
    inner = content + ' '.repeat(Math.max(0, IW - content.length));
  }
  inner = inner.slice(0, IW);
  const buf = Buffer.alloc(inner.length + 3);
  buf[0] = BOX.V;
  buf.write(inner, 1, 'ascii');
  buf[inner.length + 1] = BOX.V;
  buf[inner.length + 2] = 0x0a;
  return buf;
}

function boxEmpty(): Buffer {
  return boxLine('');
}

function boxKeyValue(label: string, value: string): Buffer {
  const gap = Math.max(1, IW - 1 - label.length - value.length);
  return boxLine(' ' + label + ' '.repeat(gap - 1) + value);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function wordWrap(s: string, width: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface FileChange {
  status: 'A' | 'M' | 'D' | 'R';
  path: string;
}

export interface ReviewResult {
  score: number;
  testsTotal?: number;
  testsPassing?: number;
  typeErrors?: boolean;
  notes?: string[];
}

export interface SessionData {
  date?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  model?: string;
  messages?: number;
  humanTurns?: number;
  toolCalls?: number;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: string;
  files?: FileChange[];
  summary?: string;
  review?: ReviewResult;
  project?: string;
}

async function renderLogo(): Promise<Buffer[]> {
  const logoPng = getLogoBuffer();
  // The embedded logo is already 1-bit: black sparkle on white bg
  // Just need to convert to raw grayscale for our raster packer
  const { data: pixels, info } = await sharp(logoPng)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const widthBytes = Math.ceil(info.width / 8);
  const rasterData = Buffer.alloc(widthBytes * info.height);

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const pixel = pixels[y * info.width + x];
      // pixel < 128 = dark = print dot
      if (pixel < 128) {
        rasterData[y * widthBytes + Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
      }
    }
  }

  return [
    newline(),
    rasterImage(rasterData, widthBytes, info.height),
    newline(),
  ];
}

export async function buildSessionReceipt(data: SessionData): Promise<Buffer> {
  const parts: Buffer[] = [init()];

  parts.push(align(Align.CENTER));

  // --- Logo ---
  try {
    parts.push(...await renderLogo());
  } catch {
    parts.push(newline(2));
  }

  // --- Title (outside box, big text) ---
  parts.push(bold(true), doubleSize(true));
  parts.push(text('CLAUDE CODE'), newline());
  parts.push(doubleSize(false));
  parts.push(text('SESSION RECEIPT'), newline());
  parts.push(bold(false));
  parts.push(newline());

  // --- Switch to left align for the box ---
  parts.push(align(Align.LEFT));

  // === TOP BORDER ===
  parts.push(topBorder());

  // --- Project name ---
  if (data.project) {
    parts.push(boxEmpty());
    parts.push(bold(true));
    parts.push(boxLine(data.project, true));
    parts.push(bold(false));
    parts.push(boxEmpty());
  }

  // --- Session info ---
  if (data.date || data.startTime || data.model) {
    if (data.project) parts.push(thinDivider());
    parts.push(boxEmpty());
    if (data.date) parts.push(boxLine(data.date, true));
    if (data.startTime && data.endTime) {
      parts.push(boxLine(`${data.startTime} ~ ${data.endTime}`, true));
    }
    if (data.duration) parts.push(boxLine(`Duration: ${data.duration}`, true));
    if (data.model) parts.push(boxLine(data.model, true));
    parts.push(boxEmpty());
  }

  // --- CONVERSATION section ---
  parts.push(sectionDivider());
  parts.push(bold(true));
  parts.push(boxLine('CONVERSATION', true));
  parts.push(bold(false));
  parts.push(thinDivider());
  if (data.messages != null) parts.push(boxKeyValue('Messages', formatNumber(data.messages)));
  if (data.humanTurns != null) parts.push(boxKeyValue('Human turns', formatNumber(data.humanTurns)));
  if (data.toolCalls != null) parts.push(boxKeyValue('Tool calls', formatNumber(data.toolCalls)));
  parts.push(boxEmpty());

  // --- TOKENS section ---
  parts.push(sectionDivider());
  parts.push(bold(true));
  parts.push(boxLine('TOKENS', true));
  parts.push(bold(false));
  parts.push(thinDivider());
  if (data.tokensIn != null) parts.push(boxKeyValue('Input', formatNumber(data.tokensIn)));
  if (data.tokensOut != null) parts.push(boxKeyValue('Output', formatNumber(data.tokensOut)));
  if (data.cacheRead != null) parts.push(boxKeyValue('Cache read', formatNumber(data.cacheRead)));
  if (data.cacheWrite != null) parts.push(boxKeyValue('Cache write', formatNumber(data.cacheWrite)));
  if (data.tokensIn != null && data.tokensOut != null) {
    const total = data.tokensIn + data.tokensOut + (data.cacheRead ?? 0) + (data.cacheWrite ?? 0);
    parts.push(thinDivider());
    parts.push(bold(true));
    parts.push(boxKeyValue('Total', formatNumber(total)));
    parts.push(bold(false));
  }
  parts.push(boxEmpty());

  // --- COST section ---
  parts.push(sectionDivider());
  parts.push(bold(true));
  parts.push(boxLine('COST', true));
  parts.push(bold(false));
  parts.push(thinDivider());
  parts.push(bold(true));
  parts.push(boxLine(data.cost ?? '$0.00', true));
  parts.push(bold(false));
  parts.push(boxEmpty());

  // --- FILES section ---
  if (data.files && data.files.length > 0) {
    parts.push(sectionDivider());
    parts.push(bold(true));
    parts.push(boxLine(`FILES (${data.files.length})`, true));
    parts.push(bold(false));
    parts.push(thinDivider());
    for (const f of data.files) {
      const maxPath = IW - 5;
      const path = f.path.length > maxPath
        ? '...' + f.path.slice(-(maxPath - 3))
        : f.path;
      parts.push(boxLine(` ${f.status} ${path}`));
    }
    parts.push(boxEmpty());
  }

  // --- SUMMARY section ---
  if (data.summary) {
    parts.push(sectionDivider());
    parts.push(bold(true));
    parts.push(boxLine('SUMMARY', true));
    parts.push(bold(false));
    parts.push(thinDivider());
    const lines = wordWrap(data.summary, IW - 4);
    for (const line of lines) {
      parts.push(boxLine('  ' + line));
    }
    parts.push(boxEmpty());
  }

  // --- CODE REVIEW section ---
  if (data.review) {
    parts.push(sectionDivider());
    parts.push(bold(true));
    parts.push(boxLine('CODE REVIEW', true));
    parts.push(bold(false));
    parts.push(thinDivider());

    // Score: close the box, print centered double-size, reopen box
    parts.push(bottomBorder());
    parts.push(align(Align.CENTER));
    parts.push(newline());
    parts.push(bold(true), doubleSize(true));
    parts.push(text(`${data.review.score.toFixed(1)}/10`), newline());
    parts.push(doubleSize(false), bold(false));
    parts.push(newline());
    parts.push(align(Align.LEFT));
    parts.push(topBorder());

    if (data.review.testsTotal != null) {
      const pass = data.review.testsPassing ?? data.review.testsTotal;
      const ok = pass === data.review.testsTotal;
      parts.push(boxLine(` ${ok ? '+' : 'x'} Tests: ${pass}/${data.review.testsTotal} passing`));
    }
    if (data.review.typeErrors != null) {
      parts.push(boxLine(` ${data.review.typeErrors ? 'x' : '+'} Type errors: ${data.review.typeErrors ? 'yes' : 'none'}`));
    }
    if (data.review.notes) {
      for (const note of data.review.notes) {
        const wrapped = wordWrap(note, IW - 6);
        parts.push(boxLine(` ~ ${wrapped[0]}`));
        for (let i = 1; i < wrapped.length; i++) {
          parts.push(boxLine(`   ${wrapped[i]}`));
        }
      }
    }
    parts.push(boxEmpty());
  }

  // === BOTTOM BORDER ===
  parts.push(bottomBorder());

  // --- Footer (outside box) ---
  parts.push(align(Align.CENTER));
  parts.push(newline());
  parts.push(text('printed by ticker'), newline());
  parts.push(newline());

  parts.push(cut());

  return Buffer.concat(parts);
}
