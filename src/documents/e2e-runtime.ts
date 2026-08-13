import { createFakeDocumentGateway } from "../test/fake-document-gateway";

export function createRuntimeDocumentGateway() {
  return createFakeDocumentGateway({ tripId: "11111111-1111-4111-8111-111111111111" }).gateway;
}
