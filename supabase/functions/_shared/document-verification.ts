export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_ARCHIVE_ENTRIES = 2_048;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_ARCHIVE_RATIO = 100;

export type DocumentValidationCode =
  | "file_too_large"
  | "unsupported_type"
  | "invalid_file"
  | "password_protected"
  | "active_content"
  | "animated_image"
  | "image_too_large"
  | "signature_conflict"
  | "unsafe_archive"
  | "archive_bomb";

export type DocumentValidationResult =
  | { kind: "valid"; detectedContentType: string }
  | { kind: "invalid"; code: DocumentValidationCode };

const OOXML_TYPES = {
  docx: {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    requiredPart: "word/document.xml"
  },
  xlsx: {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    requiredPart: "xl/workbook.xml"
  },
  pptx: {
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    requiredPart: "ppt/presentation.xml"
  }
} as const;

const expectedExtensions: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "message/rfc822": ["eml"],
  "text/plain": ["txt", "text"],
  "text/csv": ["csv"],
  [OOXML_TYPES.docx.contentType]: ["docx"],
  [OOXML_TYPES.xlsx.contentType]: ["xlsx"],
  [OOXML_TYPES.pptx.contentType]: ["pptx"]
};

const supportedMimeTypes = new Set(Object.keys(expectedExtensions));

function hasBytes(bytes: Uint8Array, offset: number, values: readonly number[]): boolean {
  return values.every((value, index) => bytes[offset + index] === value);
}

function containsBytes(bytes: Uint8Array, values: readonly number[]): boolean {
  for (let offset = 0; offset <= bytes.length - values.length; offset += 1) {
    if (hasBytes(bytes, offset, values)) return true;
  }
  return false;
}

function extensionOf(fileName: string): string {
  const leafName = fileName.replaceAll("\\", "/").split("/").pop() ?? "";
  const dot = leafName.lastIndexOf(".");
  return dot >= 0 ? leafName.slice(dot + 1).toLowerCase() : "";
}

function normalizedType(declaredType: string | null | undefined): string {
  return declaredType?.toLowerCase().split(";", 1)[0].trim() ?? "";
}

function declaredTypeMatches(declaredType: string | null | undefined, detectedType: string): boolean {
  const normalized = normalizedType(declaredType);
  if (normalized === "" || normalized === "application/octet-stream" || normalized === detectedType) return true;
  return normalized === "application/zip" && detectedType.startsWith("application/vnd.openxmlformats-officedocument.");
}

function extensionMatches(fileName: string, detectedType: string): boolean {
  return expectedExtensions[detectedType]?.includes(extensionOf(fileName)) === true;
}

function knownInput(fileName: string, declaredType: string | null | undefined): boolean {
  const extension = extensionOf(fileName);
  return Object.values(expectedExtensions).some((extensions) => extensions.includes(extension)) || supportedMimeTypes.has(normalizedType(declaredType));
}

function ascii(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function readUint16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.byteLength) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.byteLength) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function imageDimensions(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  if (type === "image/png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === "image/gif" && bytes.length >= 10) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (type === "image/webp" && hasBytes(bytes, 12, [0x56, 0x50, 0x38, 0x58]) && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    };
  }
  if (type !== "image/jpeg") return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = offset + 2 <= bytes.length ? (bytes[offset] << 8) | bytes[offset + 1] : 0;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && offset + 7 < bytes.length) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6]
      };
    }
    offset += segmentLength;
  }
  return null;
}

function gifFrameCount(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 14) return null;
  let offset = 13;
  const packed = bytes[10];
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1);
  let frames = 0;
  while (offset < bytes.byteLength) {
    const block = bytes[offset++];
    if (block === 0x3b) return frames;
    if (block === 0x2c) {
      frames += 1;
      if (offset + 9 > bytes.byteLength) return null;
      const imagePacked = bytes[offset + 8];
      offset += 9;
      if ((imagePacked & 0x80) !== 0) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
      if (offset >= bytes.byteLength) return null;
      offset += 1;
    } else if (block === 0x21) {
      if (offset >= bytes.byteLength) return null;
      offset += 1;
    } else {
      return null;
    }
    while (offset < bytes.byteLength) {
      const blockSize = bytes[offset++];
      if (blockSize === 0) break;
      offset += blockSize;
      if (offset > bytes.byteLength) return null;
    }
  }
  return null;
}

type ArchiveInspection = { kind: "valid" } | { kind: "invalid"; code: DocumentValidationCode };

function inspectOoxmlArchive(bytes: Uint8Array, extension: keyof typeof OOXML_TYPES): ArchiveInspection {
  const minimumEocdOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (hasBytes(bytes, offset, [0x50, 0x4b, 0x05, 0x06])) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return { kind: "invalid", code: "invalid_file" };
  const disk = readUint16(bytes, eocdOffset + 4);
  const centralDisk = readUint16(bytes, eocdOffset + 6);
  const diskEntries = readUint16(bytes, eocdOffset + 8);
  const entryCount = readUint16(bytes, eocdOffset + 10);
  const centralSize = readUint32(bytes, eocdOffset + 12);
  const centralOffset = readUint32(bytes, eocdOffset + 16);
  const commentLength = readUint16(bytes, eocdOffset + 20);
  if (disk === null || centralDisk === null || diskEntries === null || entryCount === null || centralSize === null || centralOffset === null || commentLength === null) return { kind: "invalid", code: "invalid_file" };
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount === 0) return { kind: "invalid", code: "invalid_file" };
  if (entryCount > MAX_ARCHIVE_ENTRIES) return { kind: "invalid", code: "archive_bomb" };
  if (eocdOffset + 22 + commentLength !== bytes.byteLength || centralOffset + centralSize !== eocdOffset) return { kind: "invalid", code: "invalid_file" };

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names = new Set<string>();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (!hasBytes(bytes, offset, [0x50, 0x4b, 0x01, 0x02])) return { kind: "invalid", code: "invalid_file" };
    const flags = readUint16(bytes, offset + 8);
    const method = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const entryCommentLength = readUint16(bytes, offset + 32);
    const localOffset = readUint32(bytes, offset + 42);
    if (flags === null || method === null || compressedSize === null || uncompressedSize === null || nameLength === null || extraLength === null || entryCommentLength === null || localOffset === null) return { kind: "invalid", code: "invalid_file" };
    if ((flags & 0x01) !== 0) return { kind: "invalid", code: "password_protected" };
    if (method !== 0 && method !== 8) return { kind: "invalid", code: "unsafe_archive" };
    const nameStart = offset + 46;
    const entryEnd = nameStart + nameLength + extraLength + entryCommentLength;
    if (entryEnd > eocdOffset) return { kind: "invalid", code: "invalid_file" };
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)).replaceAll("\\", "/");
    } catch {
      return { kind: "invalid", code: "unsafe_archive" };
    }
    const pathParts = name.split("/");
    if (!name || name.startsWith("/") || name.includes("\0") || /^[a-z]:/i.test(name) || pathParts.includes("..")) return { kind: "invalid", code: "unsafe_archive" };
    const normalizedName = name.toLowerCase();
    if (
      /(^|\/)(vbaproject\.bin|oleobject[^/]*|activex[^/]*|externalLinks)(\/|$)/i.test(name) ||
      /\.(exe|dll|com|bat|cmd|ps1|js|jse|vbs|vbe|wsf|wsh|hta|scr|jar|lnk)$/i.test(name)
    ) return { kind: "invalid", code: "active_content" };
    if (names.has(normalizedName)) return { kind: "invalid", code: "unsafe_archive" };
    names.add(normalizedName);
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) return { kind: "invalid", code: "archive_bomb" };
    if (uncompressedSize > 10 * 1024 * 1024 && uncompressedSize > Math.max(1, compressedSize) * MAX_ARCHIVE_RATIO) return { kind: "invalid", code: "archive_bomb" };
    if (!hasBytes(bytes, localOffset, [0x50, 0x4b, 0x03, 0x04])) return { kind: "invalid", code: "invalid_file" };
    const localNameLength = readUint16(bytes, localOffset + 26);
    const localExtraLength = readUint16(bytes, localOffset + 28);
    if (localNameLength === null || localExtraLength === null) return { kind: "invalid", code: "invalid_file" };
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > centralOffset) return { kind: "invalid", code: "invalid_file" };
    offset = entryEnd;
  }
  if (offset !== eocdOffset || totalCompressed > bytes.byteLength) return { kind: "invalid", code: "invalid_file" };
  if (!names.has("[content_types].xml") || !names.has(OOXML_TYPES[extension].requiredPart)) return { kind: "invalid", code: "signature_conflict" };
  return { kind: "valid" };
}

function validateText(bytes: Uint8Array): boolean {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function detectType(bytes: Uint8Array, fileName: string, declaredType: string | null | undefined): DocumentValidationResult {
  const extension = extensionOf(fileName);
  let detectedContentType: string | null = null;
  if (hasBytes(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) detectedContentType = "application/pdf";
  else if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) detectedContentType = "image/jpeg";
  else if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detectedContentType = "image/png";
  else if (hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) detectedContentType = "image/webp";
  else if (hasBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) detectedContentType = "image/gif";
  else if (hasBytes(bytes, 0, [0x50, 0x4b, 0x03, 0x04]) && extension in OOXML_TYPES) detectedContentType = OOXML_TYPES[extension as keyof typeof OOXML_TYPES].contentType;
  else if (["eml", "txt", "text", "csv"].includes(extension) && validateText(bytes)) {
    detectedContentType = extension === "csv" ? "text/csv" : extension === "eml" ? "message/rfc822" : "text/plain";
  }
  if (!detectedContentType) return { kind: "invalid", code: knownInput(fileName, declaredType) ? "signature_conflict" : "unsupported_type" };
  if (!declaredTypeMatches(declaredType, detectedContentType) || !extensionMatches(fileName, detectedContentType)) return { kind: "invalid", code: "signature_conflict" };

  if (detectedContentType === "application/pdf") {
    const content = ascii(bytes);
    const tail = ascii(bytes.subarray(Math.max(0, bytes.byteLength - 2_048)));
    if (!tail.includes("%%EOF")) return { kind: "invalid", code: "invalid_file" };
    if (/\/(?:Encrypt)\b/.test(content)) return { kind: "invalid", code: "password_protected" };
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia)\b/.test(content)) return { kind: "invalid", code: "active_content" };
  }
  if (detectedContentType.startsWith("application/vnd.openxmlformats-officedocument.")) {
    const archive = inspectOoxmlArchive(bytes, extension as keyof typeof OOXML_TYPES);
    if (archive.kind === "invalid") return archive;
  }
  if (detectedContentType.startsWith("image/") && containsBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) return { kind: "invalid", code: "signature_conflict" };
  if (detectedContentType === "image/gif") {
    const frameCount = gifFrameCount(bytes);
    if (frameCount === null) return { kind: "invalid", code: "invalid_file" };
    if (frameCount !== 1) return { kind: "invalid", code: "animated_image" };
  }
  if (detectedContentType.startsWith("image/")) {
    const dimensions = imageDimensions(bytes, detectedContentType);
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) return { kind: "invalid", code: "invalid_file" };
    if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) return { kind: "invalid", code: "image_too_large" };
  }
  return { kind: "valid", detectedContentType };
}

export function validateDocumentBytes(
  bytes: Uint8Array,
  fileName: string,
  declaredType: string | null | undefined
): DocumentValidationResult {
  if (bytes.byteLength === 0) return { kind: "invalid", code: "invalid_file" };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { kind: "invalid", code: "file_too_large" };
  return detectType(bytes, fileName, declaredType);
}
