import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { PwaProvider } from "./pwa/context";
import { PwaStatus } from "./pwa/PwaStatus";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root-Element fehlt.");
}

createRoot(rootElement).render(
  <StrictMode>
    <PwaProvider>
      <PwaStatus />
      <App />
    </PwaProvider>
  </StrictMode>
);
