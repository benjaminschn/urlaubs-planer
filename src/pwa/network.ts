export const offlineActionMessage =
  "Offline: Diese Aktion wurde nicht ausgeführt. Ihre Eingaben bleiben in diesem Formular erhalten.";

let canonicalStateReady = true;

export function setCanonicalStateReady(ready: boolean): void {
  canonicalStateReady = ready;
}

export function isNetworkAvailable(): boolean {
  return (typeof navigator === "undefined" || navigator.onLine !== false) && canonicalStateReady;
}
