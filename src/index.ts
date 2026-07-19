#!/usr/bin/env node
import nodeModule from "node:module";

// tradeoff: the bin is a thin launcher so the bundled CLI (cli.js) is loaded after
// the V8 compile cache is enabled and benefits from it on every subsequent run.
nodeModule.enableCompileCache?.();

await import("./cli.js");
