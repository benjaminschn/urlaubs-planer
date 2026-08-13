import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PwaProvider, type ServiceWorkerRegistrar, usePwa } from "./context";
import { PwaStatus } from "./PwaStatus";

function makeServiceWorkerAvailable() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {}
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("PWA release gate", () => {
  it("blockiert die Aktivierung eines Updates, solange ein Formular geöffnet ist", async () => {
    makeServiceWorkerAvailable();
    const activate = vi.fn(async () => undefined);
    let requestUpdate: (() => void) | undefined;
    const registrar: ServiceWorkerRegistrar = async (callbacks) => {
      requestUpdate = callbacks.onNeedRefresh;
      return activate;
    };

    function Harness() {
      const [formOpen, setFormOpen] = useState(true);
      return (
        <PwaProvider registrar={registrar}>
          <PwaStatus />
          {formOpen ? (
            <form aria-label="Testformular">
              <input aria-label="Entwurf" />
              <button type="button" onClick={() => setFormOpen(false)}>
                Formular schließen
              </button>
            </form>
          ) : null}
        </PwaProvider>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(requestUpdate).toBeTypeOf("function"));
    act(() => requestUpdate?.());

    const updateButton = await screen.findByRole("button", { name: "Jetzt aktualisieren" });
    await waitFor(() => expect(updateButton).toBeDisabled());
    expect(screen.getByText(/nicht automatisch neu geladen/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Formular schließen" }));
    await waitFor(() => expect(updateButton).toBeEnabled());
    await userEvent.click(updateButton);
    expect(activate).toHaveBeenCalledOnce();
  });

  it("lädt bei einer Aktivierung aus einem anderen Tab kein offenes Formular neu", async () => {
    makeServiceWorkerAvailable();
    let requestReload: (() => void) | undefined;
    const registrar: ServiceWorkerRegistrar = async (callbacks) => {
      requestReload = callbacks.onNeedReload;
      return async () => undefined;
    };

    render(
      <PwaProvider registrar={registrar}>
        <PwaStatus />
        <form aria-label="Offener Entwurf">
          <input aria-label="Entwurf" defaultValue="Nicht gespeichert" />
        </form>
      </PwaProvider>
    );
    await waitFor(() => expect(requestReload).toBeTypeOf("function"));
    act(() => requestReload?.());

    const updateButton = await screen.findByRole("button", { name: "Jetzt aktualisieren" });
    await waitFor(() => expect(updateButton).toBeDisabled());
    expect(screen.getByLabelText("Entwurf")).toHaveValue("Nicht gespeichert");
    expect(screen.getByText(/Schließen oder speichern Sie zuerst/i)).toBeInTheDocument();
  });

  it("kennzeichnet Offline-Daten als möglicherweise veraltet und meldet den Reconnect-Refresh", async () => {
    makeServiceWorkerAvailable();
    const registrar: ServiceWorkerRegistrar = async () => async () => undefined;
    let finishResync!: (ready: boolean) => void;
    function ResyncRegistration() {
      const { registerResync } = usePwa();
      useEffect(
        () => registerResync("test", () => new Promise<boolean>((resolve) => { finishResync = resolve; })),
        [registerResync]
      );
      return null;
    }
    render(
      <PwaProvider registrar={registrar}>
        <ResyncRegistration />
        <PwaStatus />
      </PwaProvider>
    );

    act(() => window.dispatchEvent(new Event("offline")));
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/es wird nichts lokal als gespeichert vorgemerkt/i)).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event("online")));
    expect(await screen.findByText("Wieder online")).toBeInTheDocument();
    expect(screen.getByText(/Serverstand wird neu geladen/i)).toBeInTheDocument();
    act(() => finishResync(true));
    await waitFor(() => expect(screen.queryByText("Wieder online")).not.toBeInTheDocument());
  });
});
