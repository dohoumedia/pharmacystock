export type CsvIssue = { rowNumber: number; code: string; field?: string; value?: string };
export type CsvRecord = { rowNumber: number; data: Record<string, string>; errors: CsvIssue[] };
export type CsvDocument = { headers: string[]; records: CsvRecord[]; errors: CsvIssue[] };

/** RFC 4180-style records: quoted separators/newlines and doubled quote escapes. */
export function parseCsvDocument(input: string): CsvDocument {
  const text = input.replace(/^\uFEFF/, '');
  const raw: { rowNumber: number; values: string[]; errors: CsvIssue[] }[] = [];
  let values: string[] = [], field = '', line = 1, rowNumber = 1;
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let rowErrors: CsvIssue[] = [];
  const issue = (code: string) => { if (!rowErrors.some((item) => item.code === code)) rowErrors.push({ rowNumber, code }); };
  const finishField = () => { values.push(field); field = ''; state = 'start'; };
  const finishRecord = () => {
    finishField();
    if (rowErrors.length || values.length > 1 || values.some((value) => value.trim())) raw.push({ rowNumber, values, errors: rowErrors });
    values = []; rowErrors = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (state === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; } else state = 'closed';
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[index + 1] === '\n') index++;
        field += '\n'; line++;
      } else field += char;
    } else if (char === ',') finishField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      finishRecord(); line++; rowNumber = line;
    } else if (char === '"' && state === 'start') state = 'quoted';
    else {
      if (char === '"' || state === 'closed') issue('CSV_UNEXPECTED_QUOTE');
      field += char; state = 'plain';
    }
  }
  if (state === 'quoted') issue('CSV_UNCLOSED_QUOTE');
  if (field.length || values.length || rowErrors.length || state === 'closed') finishRecord();
  const first = raw.shift();
  if (!first) return { headers: [], records: [], errors: [{ rowNumber: 1, code: 'CSV_HEADER_REQUIRED' }] };
  const headers = first.values.map((value) => value.trim());
  const errors = [...first.errors];
  if (headers.some((header) => !header)) errors.push({ rowNumber: first.rowNumber, code: 'CSV_HEADER_REQUIRED' });
  if (new Set(headers).size !== headers.length) errors.push({ rowNumber: first.rowNumber, code: 'CSV_DUPLICATE_HEADER' });
  const records = raw.filter((row) => row.errors.length || row.values.some((value) => value.trim()) || row.values.length !== headers.length).map((row) => {
    const recordErrors = [...row.errors];
    if (row.values.length !== headers.length) recordErrors.push({ rowNumber: row.rowNumber, code: 'CSV_COLUMN_COUNT' });
    const data = Object.fromEntries(headers.map((header, index) => [header, row.values[index] ?? '']));
    return { rowNumber: row.rowNumber, data, errors: recordErrors };
  });
  return { headers, records, errors: [...errors, ...records.flatMap((record) => record.errors)] };
}

export class CsvParseError extends Error {
  constructor(public readonly issues: CsvIssue[]) { super('CSV_INVALID_ROWS'); }
}

/** Compatibility API fails explicitly; it never drops malformed rows. */
export function parseCsv(text: string): Record<string, string>[] {
  if (!text.trim()) return [];
  const document = parseCsvDocument(text);
  if (document.errors.length) throw new CsvParseError(document.errors);
  return document.records.map((record) => record.data);
}

/** UTF-8 byte count without a browser/native TextEncoder dependency. */
export function csvByteLength(text: string): number {
  let bytes=0;
  for (const char of text) { const point=char.codePointAt(0)!; bytes+=point<=0x7f ? 1 : point<=0x7ff ? 2 : point<=0xffff ? 3 : 4; }
  return bytes;
}
