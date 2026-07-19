import { cancel, isCancel, select } from "@clack/prompts";
import { defineCommand, runCommand, runMain, showUsage, type CommandDef } from "citty";

import pkg from "../package.json";
import { cleanupCommand } from "./commands/cleanup";
import { commitCommand } from "./commands/commit";

const commands = {
  commit: commitCommand,
  cleanup: cleanupCommand,
};

type CommandName = keyof typeof commands;

const MENU: Record<CommandName, string> = {
  commit: "Stage all changes and commit with an AI-generated message",
  cleanup: "Prune repos and delete stale local branches",
};

const menuOptions = (Object.keys(MENU) as CommandName[]).map((value) => ({
  value,
  label: value,
  hint: MENU[value],
}));

const main = defineCommand({
  meta: {
    name: "zapdev",
    version: pkg.version,
    description: "Fast, precise git chores from your terminal.",
  },
  subCommands: commands,
  // citty runs this after a matched subcommand too, so bail out when one already ran.
  async run({ args, cmd }) {
    const selected = args._[0];
    if (selected && selected in commands) return;

    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      await showUsage(cmd);
      return;
    }

    const choice = await select({ message: "Which command?", options: menuOptions });
    if (isCancel(choice)) {
      cancel("Cancelled.");
      return;
    }

    await runCommand(commands[choice] as CommandDef, { rawArgs: [] });
  },
});

await runMain(main);
