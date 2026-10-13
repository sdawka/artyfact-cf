import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/base.css";
import "@/theme/index.css";
import { App } from "@/app/App";
import { loadKindViews } from "@/model/kinds";

void loadKindViews();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
