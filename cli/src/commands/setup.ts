import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import {
  readSettings,
  writeSettings,
  installHook,
} from "../settings.js";
import { installOpenCodePlugin } from "../opencode-setup.js";
import { installCodexHook } from "../codex-setup.js";

/**
 * Core hook installation logic -- installs auto-sync for Claude Code, OpenCode, and Codex.
 *
 * Extracted as a standalone function so it can be called from both
 * the `setup` command and the `auth` command (post-auth onboarding).
 *
 * @returns true if any hook was freshly installed, false if all already present
 */
export async function runSetupHook(): Promise<boolean> {
  let anyInstalled = false;

  // Claude Code: install Stop hook in ~/.claude/settings.json
  const currentSettings = await readSettings();
  const { settings: newSettings, alreadyInstalled: claudeAlready, migrated } =
    installHook(currentSettings);

  if (!claudeAlready) {
    await writeSettings(newSettings);
    anyInstalled = true;

    if (migrated) {
      console.log(chalk.green("Migrated from ccboard to clawdboard!"));
    }
  }

  // OpenCode: install plugin in ~/.config/opencode/plugins/clawdboard.ts
  let ocAlready = false;
  try {
    const result = await installOpenCodePlugin();
    ocAlready = result.alreadyInstalled;
    if (result.installed || result.updated) anyInstalled = true;
  } catch {
    // OpenCode plugin install failure is non-fatal
  }

  // Codex: install Stop hook in ~/.codex/hooks.json + features.codex_hooks flag
  let codexAlready = false;
  try {
    const result = await installCodexHook();
    codexAlready = result.alreadyInstalled;
    if (result.installed || result.updated) {
      anyInstalled = true;
      // codex_hooks is Stage::UnderDevelopment in codex; enabling it surfaces
      // an "Under-development features enabled" warning on every codex session.
      // That warning comes from codex itself — the hook is still working.
      console.log(
        chalk.dim(
          "Codex will print an 'under-development features' warning each session — that's expected while OpenAI's hooks API is unstable."
        )
      );
    }
  } catch {
    // Codex hook install failure is non-fatal
  }

  if (claudeAlready && ocAlready && codexAlready) {
    console.log(chalk.yellow("Auto-sync hooks are already installed."));
    return false;
  }

  if (anyInstalled) {
    console.log(
      chalk.dim(
        "Your data is live! Future usage syncs automatically every 2 hours."
      )
    );
    console.log(
      chalk.dim(
        "Only numbers are shared — never your prompts, code, or project names."
      )
    );
  }

  return anyInstalled;
}

/**
 * Setup command -- Install auto-sync hooks for all supported AI coding tools.
 *
 * Installs:
 * 1. Claude Code Stop hook in ~/.claude/settings.json
 * 2. OpenCode plugin in ~/.config/opencode/plugins/clawdboard.ts
 * 3. Codex Stop hook in ~/.codex/config.toml
 *
 * Idempotent: running twice does not duplicate hooks.
 */
export const setupCommand = new Command("setup")
  .description("Install auto-sync hooks for Claude Code, OpenCode, and Codex")
  .action(async () => {
    const config = await loadConfig();
    if (!config.apiToken) {
      console.error(
        chalk.red("Not authenticated. Run `clawdboard auth` first.")
      );
      process.exit(1);
    }

    const installed = await runSetupHook();

    if (!installed) {
      process.exit(0);
    }
  });
