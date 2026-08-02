/**
 * CSV serialize/parse, shared by report export and the onboarding import.
 *
 * Kept deliberately small and dependency-free, but correct on the two things a
 * naive `split(',')` gets wrong and that lose or corrupt a salon's data: fields
 * that themselves contain commas, quotes or newlines (a customer note, an
 * address), and quoted fields spanning the escaping rules. RFC 4180 quoting: a
 * field is wrapped in double quotes when it contains a comma, quote or newline,
 * and embedded quotes are doubled.
 */

function escapeField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize rows to CSV. Column order is fixed by `columns`; the header is emitted. */
export function toCsv(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
  const header = columns.map(escapeField).join(',');
  const body = rows.map((row) => columns.map((col) => escapeField(row[col])).join(','));
  return [header, ...body].join('\n');
}

/**
 * Parse CSV into records keyed by the header row. Handles quoted fields with
 * embedded commas, doubled quotes and newlines. Rows are read by a small state
 * machine rather than a regex, because quoting makes CSV not a regular language.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const [header, ...dataRows] = rows;
  if (!header) return [];

  return dataRows
    .filter((cells) => cells.length > 0 && !(cells.length === 1 && cells[0] === ''))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, i) => {
        record[key] = cells[i] ?? '';
      });
      return record;
    });
}

/** Split raw CSV text into rows of fields, honouring quotes. */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      // Swallow \r\n as one break; ignore a lone trailing newline.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += ch;
    }
  }

  // Flush the final field/row if the text did not end on a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
