import { describe, expect, it } from "vitest";
import { createFakeDocumentGateway } from "./fake-document-gateway";

function pdfFile(name = "reise.pdf") {
  return new File(["%PDF-1.7\npassive\n%%EOF"], name, { type: "application/pdf" });
}

describe("Dokument-Gateway", () => {
  it("speichert ein geprüftes Original idempotent und lädt es authentifiziert wieder", async () => {
    const fake = createFakeDocumentGateway();
    const input = {
      tripId: "22222222-2222-4222-8222-222222222222",
      file: pdfFile(),
      idempotencyKey: "upload-1",
      batchKey: "batch-1",
      batchFileCount: 1,
      batchTotalBytes: 25
    };
    const created = await fake.gateway.uploadDocument(input);
    expect(created.kind).toBe("available");
    if (created.kind !== "available") return;
    const replay = await fake.gateway.uploadDocument(input);
    expect(replay).toMatchObject({ kind: "available", document: { id: created.document.id } });
    expect(fake.getDocuments()).toHaveLength(1);
    const downloaded = await fake.gateway.downloadDocument({ tripId: input.tripId, documentId: created.document.id });
    expect(downloaded.kind).toBe("downloaded");
    if (downloaded.kind === "downloaded") expect(downloaded.fileName).toBe("reise.pdf");
  });

  it("weist sichere Negativdateien und die Auswahlgrenzen unabhängig zurück", async () => {
    const fake = createFakeDocumentGateway();
    const unsupported = await fake.gateway.uploadDocument({
      tripId: "22222222-2222-4222-8222-222222222222",
      file: new File(["MZ executable"], "reise.pdf", { type: "application/pdf" }),
      idempotencyKey: "upload-unsupported",
      batchKey: "batch-1",
      batchFileCount: 1,
      batchTotalBytes: 12
    });
    expect(unsupported.kind).toBe("failed");
    expect(unsupported).toHaveProperty("code", "signature_conflict");
    const tooMany = await fake.gateway.uploadDocument({
      tripId: "22222222-2222-4222-8222-222222222222",
      file: pdfFile("zweites.pdf"),
      idempotencyKey: "upload-too-many",
      batchKey: "batch-2",
      batchFileCount: 6,
      batchTotalBytes: 25
    });
    expect(tooMany).toMatchObject({ kind: "limit", code: "selection_too_many" });
  });
});
