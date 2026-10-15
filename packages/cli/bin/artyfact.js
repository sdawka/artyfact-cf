#!/usr/bin/env node
import { existsSync } from "node:fs";

// The published package runs the bundle; a monorepo checkout without a build runs the TypeScript source directly.
const bundle = new URL("../dist/artyfact.mjs", import.meta.url);
const { main } = await import(existsSync(bundle) ? bundle.href : "../src/main.ts");

process.exitCode = await main(process.argv.slice(2));
