#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";

import { commitCommand } from "./commands/commit";

const main = defineCommand({
  meta: {
    name: "zapgit",
    version: "0.1.0",
    description: "Fast, precise git chores from your terminal.",
  },
  subCommands: {
    commit: commitCommand,
  },
  default: "commit",
});

await runMain(main);
