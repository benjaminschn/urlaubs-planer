import {
  MAX_DOCUMENT_BYTES,
  MAX_SELECTION_BYTES,
  MAX_SELECTION_FILES
} from "./types";

export type DocumentValidationCode =
  | "file_too_large"
  | "selection_too_large"
  | "selection_too_many"
  | "unsupported_type"
  | "invalid_file"
  | "password_protected"
  | "active_content"
  | "animated_image"
  | "image_too_large"
  | "signature_conflict";

export type DocumentValidationResult =
  | { kind: "valid"; detectedContentType: string }
  | { kind: "invalid"; code: DocumentValidationCode };

export const documentErrorMessages: Record<DocumentValidationCode | string, string> = {
  file_too_large: "Die Datei ist größer als 20 MiB.",
  selection_too_large: "Die Auswahl ist größer als 50 MiB.",
  selection_too_many: "Bitte wählen Sie höchstens fünf Dateien auf einmal aus.",
  unsupported_type: "Dieses Dateiformat wird derzeit nicht unterstützt.",
  invalid_file: "Die Datei ist beschädigt oder konnte nicht sicher geprüft werden.",
  password_protected: "Passwortgeschützte Dateien können nicht geprüft werden.",
  active_content: "Dateien mit aktivem Inhalt werden nicht freigegeben.",
  animated_image: "Animierte Bilder werden nicht freigegeben.",
  image_too_large: "Das Bild enthält zu viele Pixel.",
  signature_conflict: "Dateiendung oder Dateityp stimmen nicht mit dem Dateiinhalt überein.",
  upload_failed: "Der Upload konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
  verification_unavailable: "Die Datei konnte noch nicht sicher geprüft werden. Bitte versuchen Sie es erneut.",
  document_limit: "Für diese Reise sind höchstens 50 Originaldokumente vorgesehen.",
  parallel_limit: "Es laufen bereits zwei Uploads. Der Upload wird nach Abschluss fortgesetzt.",
  forbidden: "Das Dokument ist nicht verfügbar.",
  unknown: "Das Dokument konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut."
};

const supportedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "message/rfc822",
  "text/plain",
  "text/csv"
]);

function hasBytes(bytes: Uint8Array, offset: number, values: number[]): boolean {
  return values.every((value, index) => bytes[offset + index] === value);
}

function containsBytes(bytes: Uint8Array, values: number[]): boolean {
  for (let offset = 0; offset <= bytes.length - values.length; offset += 1) {
    if (hasBytes(bytes, offset, values)) return true;
  }
  return false;
}

function ascii(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function declaredTypeMatches(declaredType: string | null | undefined, detectedType: string): boolean {
  const normalized = declaredType?.toLowerCase().split(";", 1)[0].trim() ?? "";
  return normalized === "" || normalized === "application/octet-stream" || normalized === detectedType;
}

function extensionMatches(fileName: string, detectedType: string): boolean {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const extensions: Record<string, string[]> = {
    "application/pdf": ["pdf"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "image/gif": ["gif"],
    "message/rfc822": ["eml"],
    "text/plain": ["txt", "text"],
    "text/csv": ["csv"]
  };
  return !extensions[detectedType] || extensions[detectedType].includes(extension);
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
  if (type === "image/webp" && hasBytes(bytes, 12, [86, 80, 56, 88]) && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height };
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
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xc3 || marker >= 0xc5 && marker <= 0xc7 || marker >= 0xc9 && marker <= 0xcb || marker >= 0xcd && marker <= 0xcf;
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

function detectType(bytes: Uint8Array, fileName: string, declaredType: string | null | undefined): DocumentValidationResult {
  let detectedContentType: string | null = null;
  if (hasBytes(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) detectedContentType = "application/pdf";
  else if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) detectedContentType = "image/jpeg";
  else if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detectedContentType = "image/png";
  else if (hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) detectedContentType = "image/webp";
  else if (hasBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) detectedContentType = "image/gif";
  else {
    const lowerName = fileName.toLowerCase();
    const textLike = lowerName.endsWith(".eml") || lowerName.endsWith(".txt") || lowerName.endsWith(".text") || lowerName.endsWith(".csv") || declaredType === "message/rfc822" || declaredType === "text/plain" || declaredType === "text/csv";
    if (textLike && !bytes.includes(0)) detectedContentType = lowerName.endsWith(".csv") || declaredType === "text/csv" ? "text/csv" : lowerName.endsWith(".eml") || declaredType === "message/rfc822" ? "message/rfc822" : "text/plain";
  }
  if (!detectedContentType || !supportedMimeTypes.has(detectedContentType)) {
    const declared = declaredType?.toLowerCase().split(";", 1)[0].trim() ?? "";
    const knownExtensions = ["pdf", "jpg", "jpeg", "png", "webp", "gif", "eml", "txt", "text", "csv"];
    return supportedMimeTypes.has(declared) || knownExtensions.includes(fileName.toLowerCase().split(".").pop() ?? "")
      ? { kind: "invalid", code: "signature_conflict" }
      : { kind: "invalid", code: "unsupported_type" };
  }
  if (!declaredTypeMatches(declaredType, detectedContentType) || !extensionMatches(fileName, detectedContentType)) return { kind: "invalid", code: "signature_conflict" };
  const bytesText = ascii(bytes);
  if (detectedContentType === "application/pdf") {
    if (!bytesText.includes("%%EOF")) return { kind: "invalid", code: "invalid_file" };
    if (/\/(?:Encrypt)\b/.test(bytesText)) return { kind: "invalid", code: "password_protected" };
    if (/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(bytesText)) return { kind: "invalid", code: "active_content" };
  }
  if (detectedContentType.startsWith("image/") && containsBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) return { kind: "invalid", code: "signature_conflict" };
  if (detectedContentType === "image/gif") {
    const frames = bytes.reduce((count, value) => count + (value === 0x2c ? 1 : 0), 0);
    if (frames !== 1) return { kind: "invalid", code: "animated_image" };
  }
  if (detectedContentType.startsWith("image/")) {
    const dimensions = imageDimensions(bytes, detectedContentType);
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) return { kind: "invalid", code: "invalid_file" };
    if (dimensions.width * dimensions.height > 40_000_000) return { kind: "invalid", code: "image_too_large" };
  }
  return { kind: "valid", detectedContentType };
}

export function validateDocumentBytes(
  bytes: Uint8Array,
  fileName: string,
  declaredType: string | null | undefined
): DocumentValidationResult {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { kind: "invalid", code: "file_too_large" };
  return detectType(bytes, fileName, declaredType);
}

export function validateDocumentSelection(files: readonly Pick<File, "size">[]): string | null {
  if (files.length > MAX_SELECTION_FILES) return documentErrorMessages.selection_too_many;
  if (files.some((file) => file.size > MAX_DOCUMENT_BYTES)) return documentErrorMessages.file_too_large;
  if (files.reduce((total, file) => total + file.size, 0) > MAX_SELECTION_BYTES) return documentErrorMessages.selection_too_large;
  return null;
}

export function documentErrorMessage(code: string | null | undefined): string {
  return documentErrorMessages[code ?? "unknown"] ?? documentErrorMessages.unknown;
}

export function isInlineDocumentType(contentType: string | null): boolean {
  return contentType?.startsWith("image/") === true;
}
