// Claude Code session receipt builder

import {
  init, align, Align, bold, doubleSize, text, newline, separator, cut,
  rasterImage,
} from './escpos.ts';
import { buildImagePrint, fetchImage } from './raster.ts';
import { getLogoPng } from './logo.ts';
import sharp from 'sharp';

const W = 48; // receipt character width

export interface FileChange {
  status: 'A' | 'M' | 'D' | 'R'; // added, modified, deleted, renamed
  path: string;
}

export interface ReviewResult {
  score: number; // 0-10
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

function center(s: string, width = W): string {
  const pad = Math.max(0, Math.floor((width - s.length) / 2));
  return ' '.repeat(pad) + s;
}

function rightAlign(label: string, value: string, width = W): string {
  const gap = Math.max(1, width - label.length - value.length);
  return label + ' '.repeat(gap) + value;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function sectionHeader(title: string): Buffer[] {
  return [
    newline(),
    bold(true),
    text(center(title)), newline(),
    bold(false),
    text(center('-'.repeat(Math.min(title.length + 4, W)))), newline(),
  ];
}

function wordWrap(s: string, width = W - 4): string[] {
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

export async function buildSessionReceipt(data: SessionData): Promise<Buffer> {
  const parts: Buffer[] = [init()];

  // Logo
  try {
    const logoPng = await getLogoPng();
    const resized = sharp(logoPng)
      .resize(200, 200, { fit: 'inside' })
      .grayscale()
      .threshold(128);

    const { data: pixels, info } = await resized.raw().toBuffer({ resolveWithObject: true });
    const widthBytes = Math.ceil(info.width / 8);
    const rasterData = Buffer.alloc(widthBytes * info.height);

    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (pixels[y * info.width + x] === 0) {
          rasterData[y * widthBytes + Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
        }
      }
    }

    parts.push(align(Align.CENTER), newline());
    parts.push(rasterImage(rasterData, widthBytes, info.height));
  } catch {
    // Skip logo on error
  }

  // Title
  parts.push(align(Align.CENTER), newline());
  parts.push(bold(true), doubleSize(true));
  parts.push(text('CLAUDE CODE'), newline());
  parts.push(doubleSize(false));
  parts.push(text('SESSION RECEIPT'), newline());
  parts.push(bold(false));
  parts.push(text('='.repeat(W)), newline());

  // Session info
  if (data.project) {
    parts.push(newline());
    parts.push(bold(true), text(center(data.project)), newline(), bold(false));
  }

  if (data.date || data.startTime) {
    parts.push(newline());
    if (data.date) {
      parts.push(text(center(data.date)), newline());
    }
    if (data.startTime && data.endTime) {
      parts.push(text(center(`${data.startTime} - ${data.endTime}`)), newline());
    }
    if (data.duration) {
      parts.push(text(center(`Duration: ${data.duration}`)), newline());
    }
  }

  if (data.model) {
    parts.push(text(center(data.model)), newline());
  }

  // Conversation stats
  parts.push(...sectionHeader('CONVERSATION'));
  parts.push(align(Align.LEFT));
  if (data.messages != null) {
    parts.push(text('  ' + rightAlign('Messages', formatNumber(data.messages), W - 4)), newline());
  }
  if (data.humanTurns != null) {
    parts.push(text('  ' + rightAlign('Human turns', formatNumber(data.humanTurns), W - 4)), newline());
  }
  if (data.toolCalls != null) {
    parts.push(text('  ' + rightAlign('Tool calls', formatNumber(data.toolCalls), W - 4)), newline());
  }

  // Tokens
  parts.push(align(Align.CENTER));
  parts.push(...sectionHeader('TOKENS'));
  parts.push(align(Align.LEFT));
  if (data.tokensIn != null) {
    parts.push(text('  ' + rightAlign('Input', formatNumber(data.tokensIn), W - 4)), newline());
  }
  if (data.tokensOut != null) {
    parts.push(text('  ' + rightAlign('Output', formatNumber(data.tokensOut), W - 4)), newline());
  }
  if (data.cacheRead != null) {
    parts.push(text('  ' + rightAlign('Cache read', formatNumber(data.cacheRead), W - 4)), newline());
  }
  if (data.cacheWrite != null) {
    parts.push(text('  ' + rightAlign('Cache write', formatNumber(data.cacheWrite), W - 4)), newline());
  }
  if (data.tokensIn != null && data.tokensOut != null) {
    const total = data.tokensIn + data.tokensOut + (data.cacheRead ?? 0) + (data.cacheWrite ?? 0);
    parts.push(text('  ' + '-'.repeat(W - 4)), newline());
    parts.push(bold(true));
    parts.push(text('  ' + rightAlign('Total', formatNumber(total), W - 4)), newline());
    parts.push(bold(false));
  }

  // Cost
  parts.push(align(Align.CENTER));
  parts.push(...sectionHeader('COST'));
  parts.push(bold(true));
  parts.push(text(center(data.cost ?? '$0.00')), newline());
  parts.push(bold(false));

  // Files
  if (data.files && data.files.length > 0) {
    parts.push(...sectionHeader(`FILES (${data.files.length})`));
    parts.push(align(Align.LEFT));
    for (const f of data.files) {
      const statusChar = f.status;
      // Truncate long paths
      const maxPath = W - 6;
      const path = f.path.length > maxPath
        ? '...' + f.path.slice(-(maxPath - 3))
        : f.path;
      parts.push(text(`  ${statusChar} ${path}`), newline());
    }
  }

  // Summary
  if (data.summary) {
    parts.push(align(Align.CENTER));
    parts.push(...sectionHeader('SUMMARY'));
    parts.push(align(Align.LEFT));
    const lines = wordWrap(data.summary);
    for (const line of lines) {
      parts.push(text('  ' + line), newline());
    }
  }

  // Code review
  if (data.review) {
    parts.push(align(Align.CENTER));
    parts.push(...sectionHeader('CODE REVIEW'));
    parts.push(newline());
    parts.push(bold(true), doubleSize(true));
    parts.push(text(center(`${data.review.score.toFixed(1)}/10`)), newline());
    parts.push(doubleSize(false), bold(false));
    parts.push(newline());
    parts.push(align(Align.LEFT));

    if (data.review.testsTotal != null) {
      const pass = data.review.testsPassing ?? data.review.testsTotal;
      const ok = pass === data.review.testsTotal;
      parts.push(text(`  ${ok ? '+' : 'x'} Tests: ${pass}/${data.review.testsTotal} passing`), newline());
    }
    if (data.review.typeErrors != null) {
      parts.push(text(`  ${data.review.typeErrors ? 'x' : '+'} Type errors: ${data.review.typeErrors ? 'yes' : 'none'}`), newline());
    }
    if (data.review.notes) {
      for (const note of data.review.notes) {
        parts.push(text(`  ~ ${note}`), newline());
      }
    }
  }

  // Footer
  parts.push(align(Align.CENTER), newline());
  parts.push(text('='.repeat(W)), newline());
  parts.push(text(center('printed by ticker')), newline());
  parts.push(text('='.repeat(W)), newline());

  parts.push(cut());

  return Buffer.concat(parts);
}
