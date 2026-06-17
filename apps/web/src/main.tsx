import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { I18nProvider } from "./app/i18n/index.js";
import "./styles/index.css";

async function bootstrap() {
  if (import.meta.env.DEV) {
    await import("./dev/tuttiExternalMock.js");
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}

void bootstrap();
