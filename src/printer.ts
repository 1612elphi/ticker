// TCP connection to the receipt printer with simple serial queue

import { connect, type Socket } from 'net';

const PRINTER_HOST = process.env.PRINTER_HOST ?? '192.168.1.200';
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT ?? '9100', 10);

type QueueItem = {
  data: Buffer;
  resolve: () => void;
  reject: (err: Error) => void;
};

const queue: QueueItem[] = [];
let busy = false;

async function processQueue() {
  if (busy || queue.length === 0) return;
  busy = true;

  const item = queue.shift()!;

  try {
    await sendToPrinter(item.data);
    item.resolve();
  } catch (err) {
    item.reject(err instanceof Error ? err : new Error(String(err)));
  } finally {
    busy = false;
    processQueue();
  }
}

function sendToPrinter(data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect({ host: PRINTER_HOST, port: PRINTER_PORT }, () => {
      socket.write(data, (err) => {
        socket.end();
        if (err) reject(err);
        else resolve();
      });
    });

    socket.setTimeout(10_000);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Printer connection timed out'));
    });
    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

export function print(data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    queue.push({ data, resolve, reject });
    processQueue();
  });
}
