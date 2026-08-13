import { describe, expect, it } from "vitest";
import { validateDocumentBytes } from "./validation";

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function littleEndian(value: number, bytes: 2 | 4): Uint8Array {
  const result = new Uint8Array(bytes);
  const view = new DataView(result.buffer);
  if (bytes === 2) view.setUint16(0, value, true);
  else view.setUint32(0, value, true);
  return result;
}

function storedZip(entries: readonly { name: string; content?: string; uncompressedSize?: number }[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.content ?? "x");
    const uncompressedSize = entry.uncompressedSize ?? content.byteLength;
    const local = concat([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      littleEndian(20, 2),
      littleEndian(0, 2),
      littleEndian(0, 2),
      new Uint8Array(4),
      littleEndian(0, 4),
      littleEndian(content.byteLength, 4),
      littleEndian(uncompressedSize, 4),
      littleEndian(name.byteLength, 2),
      littleEndian(0, 2),
      name,
      content
    ]);
    const central = concat([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      littleEndian(20, 2),
      littleEndian(20, 2),
      littleEndian(0, 2),
      littleEndian(0, 2),
      new Uint8Array(4),
      littleEndian(0, 4),
      littleEndian(content.byteLength, 4),
      littleEndian(uncompressedSize, 4),
      littleEndian(name.byteLength, 2),
      littleEndian(0, 2),
      littleEndian(0, 2),
      littleEndian(0, 2),
      littleEndian(0, 2),
      littleEndian(0, 4),
      littleEndian(localOffset, 4),
      name
    ]);
    localParts.push(local);
    centralParts.push(central);
    localOffset += local.byteLength;
  }
  const locals = concat(localParts);
  const central = concat(centralParts);
  const eocd = concat([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    littleEndian(0, 2),
    littleEndian(0, 2),
    littleEndian(entries.length, 2),
    littleEndian(entries.length, 2),
    littleEndian(central.byteLength, 4),
    littleEndian(locals.byteLength, 4),
    littleEndian(0, 2)
  ]);
  return concat([locals, central, eocd]);
}

describe("document byte validation", () => {
  it("accepts passive PDFs and rejects active PDF actions", () => {
    const passive = new TextEncoder().encode("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n");
    const active = new TextEncoder().encode("%PDF-1.7\n/JavaScript 1 0 R\n%%EOF\n");

    expect(validateDocumentBytes(passive, "booking.pdf", "application/pdf")).toEqual({
      kind: "valid",
      detectedContentType: "application/pdf"
    });
    expect(validateDocumentBytes(active, "booking.pdf", "application/pdf")).toEqual({
      kind: "invalid",
      code: "active_content"
    });
  });

  it("accepts a minimal passive DOCX container", () => {
    const bytes = storedZip([
      { name: "[Content_Types].xml", content: "<Types/>" },
      { name: "word/document.xml", content: "<document/>" }
    ]);

    expect(validateDocumentBytes(bytes, "booking.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toEqual({
      kind: "valid",
      detectedContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  });

  it("rejects active, traversing, and decompression-bomb OOXML containers", () => {
    const active = storedZip([
      { name: "[Content_Types].xml" },
      { name: "word/document.xml" },
      { name: "word/vbaProject.bin" }
    ]);
    const traversal = storedZip([
      { name: "[Content_Types].xml" },
      { name: "word/document.xml" },
      { name: "../payload.bin" }
    ]);
    const bomb = storedZip([
      { name: "[Content_Types].xml" },
      { name: "word/document.xml", uncompressedSize: 11 * 1024 * 1024 }
    ]);

    expect(validateDocumentBytes(active, "booking.docx", "application/zip")).toEqual({ kind: "invalid", code: "active_content" });
    expect(validateDocumentBytes(traversal, "booking.docx", "application/zip")).toEqual({ kind: "invalid", code: "unsafe_archive" });
    expect(validateDocumentBytes(bomb, "booking.docx", "application/zip")).toEqual({ kind: "invalid", code: "archive_bomb" });
  });

  it("rejects MIME conflicts and invalid UTF-8 passive text", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const invalidText = new Uint8Array([0xc3, 0x28]);

    expect(validateDocumentBytes(pdf, "booking.pdf", "image/png")).toEqual({ kind: "invalid", code: "signature_conflict" });
    expect(validateDocumentBytes(invalidText, "booking.txt", "text/plain")).toEqual({ kind: "invalid", code: "signature_conflict" });
  });
});
