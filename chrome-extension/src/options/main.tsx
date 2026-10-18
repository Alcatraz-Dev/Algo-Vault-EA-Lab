import React from "react";
import ReactDOM from "react-dom/client";
import OptionsApp from "./App";
import "@/styles/tokens.css";
import "./styles.css";
import { initTheme } from "@/theme";

initTheme().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <OptionsApp />
    </React.StrictMode>
  );
});
