import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import WorkOpsPage from "./pages/WorkOpsPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkOpsPage />
  </StrictMode>,
);
