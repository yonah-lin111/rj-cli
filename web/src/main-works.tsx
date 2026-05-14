import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import WorksPage from "./pages/WorksPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorksPage />
  </StrictMode>,
);
