import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig } from "../config.js";

export const antigravityCommand = new Command("antigravity")
  .description("Manage Antigravity sync settings (opt-in)");

antigravityCommand
  .command("enable")
  .description("Opt in to Antigravity usage syncing")
  .action(async () => {
    const config = await loadConfig();
    if (config.antigravity?.enabled) {
      console.log(chalk.green("Antigravity sync is already enabled."));
      return;
    }

    console.log("");
    console.log(chalk.bold("Enabling Antigravity usage sync"));
    console.log("");
    console.log(
      "Antigravity stores conversations as opaque protobuf, so on-disk parsing"
    );
    console.log(
      "isn't possible. To track usage, the clawdboard CLI will:"
    );
    console.log("");
    console.log(chalk.yellow("  1.") + " Read ~/.gemini/oauth_creds.json (gemini-cli's auth file)");
    console.log(chalk.yellow("  2.") + " Make HTTPS calls to cloudcode-pa.googleapis.com");
    console.log(chalk.yellow("  3.") + " Send aggregate token counts (no prompts/code) to clawdboard");
    console.log("");
    console.log(chalk.dim("Tokens never leave your machine. Same privacy guarantees as the other"));
    console.log(chalk.dim("extractors. You can disable at any time with `clawdboard antigravity disable`."));
    console.log("");

    await saveConfig({
      ...config,
      antigravity: { enabled: true },
    });

    console.log(chalk.green("✓ Antigravity sync enabled."));
    console.log(chalk.dim("Run `clawdboard sync` to fetch your usage."));
  });

antigravityCommand
  .command("disable")
  .description("Opt out of Antigravity usage syncing")
  .action(async () => {
    const config = await loadConfig();
    if (!config.antigravity?.enabled) {
      console.log(chalk.dim("Antigravity sync is already disabled."));
      return;
    }
    await saveConfig({
      ...config,
      antigravity: { enabled: false },
    });
    console.log(chalk.green("✓ Antigravity sync disabled."));
  });

antigravityCommand
  .command("status")
  .description("Show current Antigravity sync status")
  .action(async () => {
    const config = await loadConfig();
    const enabled = config.antigravity?.enabled === true;
    console.log(
      `Antigravity sync: ${enabled ? chalk.green("enabled") : chalk.dim("disabled")}`
    );
    if (enabled) {
      console.log(chalk.dim("Disable with: clawdboard antigravity disable"));
    } else {
      console.log(chalk.dim("Enable with:  clawdboard antigravity enable"));
    }
  });
