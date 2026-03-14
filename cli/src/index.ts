#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import { authCommand } from "./commands/auth.js";
import { syncCommand } from "./commands/sync.js";
import { setupCommand } from "./commands/setup.js";
import { rankCommand } from "./commands/rank.js";
import { leaderboardCommand } from "./commands/leaderboard.js";
import { runHookSync } from "./hook.js";
import { loadConfig } from "./config.js";
import { VERSION } from "./version.js";

program
  .name("clawdboard")
  .description("AI coding agent leaderboard CLI")
  .version(VERSION);

program.addCommand(authCommand);
program.addCommand(syncCommand);
program.addCommand(setupCommand);
program.addCommand(rankCommand);
program.addCommand(leaderboardCommand);

program
  .command("hook-sync", { hidden: true })
  .description("Internal: auto-sync triggered by hook")
  .action(async () => {
    await runHookSync();
  });

// If no subcommand is given and no token exists, default to `auth`
async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const hasSubcommand =
    args.length > 0 &&
    !args.every((a) => a.startsWith("-"));

  if (!hasSubcommand) {
    const config = await loadConfig();
    if (!config.apiToken) {
      // No token and no subcommand -- run auth as the default onboarding flow
      process.argv.splice(2, 0, "auth");
    }
  }

  await program.parseAsync();
}

run().catch((err: unknown) => {
  if (err instanceof Error) {
    console.error(chalk.red(`Error: ${err.message}`));
  } else {
    console.error(chalk.red("An unexpected error occurred."));
  }
  process.exit(1);
});
