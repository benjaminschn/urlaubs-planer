import {
  validateDocumentBytes,
  type DocumentValidationCode,
  type DocumentValidationResult
} from "../../supabase/functions/_shared/document-verification";
import {
  MAX_DOCUMENT_BYTES,
  MAX_SELECTION_BYTES,
  MAX_SELECTION_FILES
} from "./types";

export { validateDocumentBytes };
export type { DocumentValidationCode, DocumentValidationResult };

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
  unsafe_archive: "Der Office-Container enthält unsichere oder mehrdeutige Einträge.",
  archive_bomb: "Der Office-Container überschreitet die sicheren Entpackgrenzen.",
  malware_detected: "Die Datei wurde durch die Schadsoftwareprüfung abgelehnt.",
  upload_failed: "Der Upload konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
  verification_unavailable: "Die Datei konnte noch nicht sicher geprüft werden. Bitte versuchen Sie es erneut.",
  document_limit: "Für diese Reise sind höchstens 50 Originaldokumente vorgesehen.",
  parallel_limit: "Es laufen bereits zwei Uploads. Der Upload wird nach Abschluss fortgesetzt.",
  forbidden: "Das Dokument ist nicht verfügbar.",
  unknown: "Das Dokument konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut."
};

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
