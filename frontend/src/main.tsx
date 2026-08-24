import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
// @ts-expect-error Astryx 0.4.7 exports a missing theme.css.d.ts declaration.
import "@astryxdesign/theme-neutral/theme.css";
import {App} from "./app/App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
