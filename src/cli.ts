#!/usr/bin/env node
import { getHelpOutput, startInteractiveApp } from "./app.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(getHelpOutput());
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log("0.1.0");
  process.exit(0);
}

startInteractiveApp().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
