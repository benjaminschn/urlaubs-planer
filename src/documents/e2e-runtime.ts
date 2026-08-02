import { createFakeDocumentGateway } from "../test/fake-document-gateway";

export function createRuntimeDocumentGateway() {
  return createFakeDocumentGateway().gateway;
}
