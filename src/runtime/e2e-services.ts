import { createRuntimeAuthGateway } from "../auth/e2e-runtime";
import { createRuntimeTripGateway } from "../trip/e2e-runtime";
import type { RuntimeServices } from "./services";

export function createRuntimeServices(): RuntimeServices {
  return {
    authGateway: createRuntimeAuthGateway(),
    tripGateway: createRuntimeTripGateway()
  };
}
