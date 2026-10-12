// CSV for spreadsheets (Excel, LibreOffice, Google Sheets): RFC 4180 quoting, CRLF lines,
// a UTF-8 BOM so Excel reads Hebrew correctly, and formula-injection protection.

/**
 * A cell starting with one of these is run as a formula by spreadsheets ("=HYPERLINK(...)").
 * Tab and CR count too (OWASP "CSV injection").
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell: neutralize formulas with a leading quote, then quote if it holds , " or a line break. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Byte order mark: without it Excel opens UTF-8 as Windows-1255/1252 and Hebrew turns to gibberish. */
export const UTF8_BOM = "﻿";

/** Save text as a .csv file (built in memory; nothing is sent anywhere). */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([UTF8_BOM + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
