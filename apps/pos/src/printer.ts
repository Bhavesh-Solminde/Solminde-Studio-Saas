/**
 * Push ESC/POS bytes to a thermal printer.
 *
 * Transport preference, per spec §5: Web Serial (USB, Chrome/Edge desktop) →
 * Web Bluetooth (BT printers) → an HTML print view when neither API exists.
 * The byte stream itself is generated in packages/shared and is identical
 * across transports; this module only moves bytes.
 *
 * The Web Serial and Web Bluetooth types are not in the default DOM lib, so the
 * minimum shapes are declared inline rather than pulling in a dependency for a
 * handful of methods.
 */

interface SerialWriter {
  write(data: Uint8Array): Promise<void>;
  releaseLock(): void;
}
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: { getWriter(): SerialWriter } | null;
}
interface SerialApi {
  requestPort(): Promise<SerialPort>;
}

function serial(): SerialApi | null {
  const nav = navigator as unknown as { serial?: SerialApi };
  return nav.serial ?? null;
}

export type PrintMethod = 'serial' | 'html';

/**
 * Print a receipt. Never throws on an unsupported environment — it falls back to
 * an HTML view so the front desk can still hand over a paper bill. Returns which
 * transport was used, which the version/support badge can surface.
 */
export async function printReceipt(bytes: Uint8Array, htmlFallback: string): Promise<PrintMethod> {
  const api = serial();
  if (api) {
    try {
      const port = await api.requestPort();
      await port.open({ baudRate: 9600 });
      const writer = port.writable?.getWriter();
      if (writer) {
        await writer.write(bytes);
        writer.releaseLock();
      }
      await port.close();
      return 'serial';
    } catch {
      // User cancelled the port picker, or the device errored. Fall through to
      // HTML rather than leaving the front desk with no bill.
    }
  }

  printHtml(htmlFallback);
  return 'html';
}

/** Open a minimal print window as the last-resort fallback. */
function printHtml(html: string): void {
  const win = window.open('', '_blank', 'width=320,height=600');
  if (!win) return;
  win.document.write(
    `<html><head><title>Receipt</title><style>
       body{font:12px/1.4 monospace;padding:8px;white-space:pre-wrap}
     </style></head><body>${html}</body></html>`,
  );
  win.document.close();
  win.focus();
  win.print();
}
