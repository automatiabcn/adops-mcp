/**
 * Minimal CSV parser with RFC 4180 support:
 *  - Quoted fields with embedded commas, newlines, and escaped quotes ("")
 *  - BOM handling for UTF-8 CSVs exported from Windows tools (Meta Ads)
 *  - Empty-line skipping
 *  - Configurable delimiter (default ",") for semicolon exports (some EU locales)
 *
 * Zero external dependencies, streams-free — accepts a full string buffer.
 * Returns an array of objects keyed by header row.
 */

export type CsvRow = Record<string, string>;

export interface ParseOptions {
  delimiter?: string; // default ","
  skipEmptyLines?: boolean; // default true
  trimHeaders?: boolean; // default true
}

export function parseCsv(input: string, options: ParseOptions = {}): CsvRow[] {
  const delimiter = options.delimiter ?? ',';
  const skipEmpty = options.skipEmptyLines ?? true;
  const trimHeaders = options.trimHeaders ?? true;

  // Strip UTF-8 BOM if present (Excel/Meta exports)
  let text = input;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = tokenize(text, delimiter);
  if (rows.length === 0) return [];

  const [headerRow, ...bodyRows] = rows;
  const headers = trimHeaders ? headerRow.map((h) => h.trim()) : headerRow;

  const out: CsvRow[] = [];
  for (const row of bodyRows) {
    if (skipEmpty && row.every((c) => c === '')) continue;
    const obj: CsvRow = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = row[i] ?? '';
    }
    out.push(obj);
  }
  return out;
}

/**
 * RFC 4180 tokenizer — returns array of rows, each row is array of cell strings.
 * Handles:
 *   - "quoted fields, with commas"
 *   - "embedded ""quotes"""
 *   - "multi-line
 *      fields"
 */
function tokenize(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Double-quote inside quoted field = literal "
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // CRLF handling — consume \r, let \n do the row-push
      i++;
      continue;
    }
    cell += ch;
    i++;
  }

  // Flush trailing cell/row (no final newline)
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Best-effort number parser that strips common CSV number formatting:
 *   "1,234.56"  -> 1234.56
 *   "1.234,56"  -> 1234.56 (European locale)
 *   "$1,234.56" -> 1234.56
 *   "12.5%"     -> 12.5
 *   ""          -> 0
 *   "--"        -> 0 (Google Ads "no data" marker)
 */
export function parseNumber(raw: string | undefined | null): number {
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (s === '' || s === '--' || s === '-' || s.toLowerCase() === 'n/a') return 0;

  // Strip currency symbols and percent
  s = s.replace(/[$€£¥₺₹]/g, '').replace(/%/g, '').trim();

  // Detect European format ("1.234,56") vs US format ("1,234.56")
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Whichever comes LAST is the decimal separator
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      // European: "1.234,56"
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US: "1,234.56"
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // Ambiguous: "1,234" could be 1234 (US) or 1.234 (EU). If 3+ digits after comma → thousands sep.
    const afterComma = s.split(',').pop() ?? '';
    if (afterComma.length === 3) {
      s = s.replace(/,/g, ''); // thousands separator
    } else {
      s = s.replace(',', '.'); // decimal separator
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Try to auto-detect CSV delimiter by sampling first non-header line.
 * Returns "," (default), ";", or "\t".
 */
export function detectDelimiter(sample: string): string {
  const firstFewLines = sample.split('\n').slice(0, 5).join('\n');
  const counts = {
    ',': (firstFewLines.match(/,/g) || []).length,
    ';': (firstFewLines.match(/;/g) || []).length,
    '\t': (firstFewLines.match(/\t/g) || []).length,
  };
  const winner = (Object.entries(counts) as [string, number][])
    .sort((a, b) => b[1] - a[1])[0];
  return winner[1] > 0 ? winner[0] : ',';
}
