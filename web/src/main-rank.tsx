import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import RankPage from "./pages/RankPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RankPage />
  </StrictMode>
);
