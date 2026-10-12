import { describe, expect, it, vi } from "vitest";

import { csvCell, downloadCsv, toCsv, UTF8_BOM } from "./csv";

describe("csvCell", () => {
  it.each([
    ["plain", "plain"],
    ["Tel Aviv, Expo", '"Tel Aviv, Expo"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
    ["cr\rhere", '"cr\rhere"'],
    ["שני קדר", "שני קדר"],
    ["", ""],
  ])("%j → %j", (input, output) => {
    expect(csvCell(input)).toBe(output);
  });

  it.each(["=1+1", "+1", "-2", "@SUM(A1)", "=HYPERLINK(\"http://evil\",\"x\")", "\tTAB"])(
    "neutralizes formula-looking %j with a leading quote",
    (input) => {
      const cell = csvCell(input);
      expect(cell.replace(/^"/, "")).toMatch(/^'/);
    },
  );

  it("quotes a neutralized formula that also needs quoting", () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });

  it("numbers and empties", () => {
    expect(csvCell(99.1)).toBe("99.1");
    expect(csvCell(-5)).toBe("'-5"); // a negative number looks like a formula too; harmless with a quote
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv and downloadCsv", () => {
  it("joins with commas and CRLF", () => {
    expect(toCsv([["a", "b,c"], ["1", null]])).toBe('a,"b,c"\r\n1,\r\n');
  });

  it("downloads with a UTF-8 BOM and frees the URL", async () => {
    let saved: Blob | null = null;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved = blob;
      return "blob:csv";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("logs.csv", "שם,x\r\n");

    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:csv");
    expect(saved!.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await saved!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the BOM, as UTF-8 bytes
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(UTF8_BOM + "שם,x\r\n"); // keep the BOM
    click.mockRestore();
  });
});
