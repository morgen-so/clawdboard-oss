import { Command } from "commander";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import { loadConfig, getServerUrl, type Config } from "../config.js";
import { ApiClient, ApiError } from "../api-client.js";
import { extractAndSanitize } from "../extract.js";
import { markSynced, DEBOUNCE_MS } from "../hook.js";
import { getMachineId } from "../machine-id.js";

/**
 * Core sync logic -- extract, sanitize, and upload usage data.
 *
 * Extracted as a standalone function so it can be called from both
 * the `sync` command and the `auth` command (post-auth onboarding).
 *
 * @param config - Pre-loaded config (must contain apiToken)
 * @param options - Optional since date and dry-run flag
 * @param spinner - Optional ora spinner instance (creates one if not provided)
 */
export async function runSync(
  config: Config,
  options: { since?: string; dryRun?: boolean } = {},
  spinner?: Ora
): Promise<void> {
  const s = spinner ?? ora();
  const serverUrl = getServerUrl(config);

  // Step 1: Extract usage data
  s.start("Extracting usage data...");

  let payload;
  try {
    payload = await extractAndSanitize(options.since);
  } catch (err) {
    s.fail("Could not read usage data.");
    if (err instanceof Error) {
      console.error(
        chalk.dim("Make sure you have used Claude Code, OpenCode, or Codex on this machine.")
      );
      console.error(chalk.dim(`Detail: ${err.message}`));
    }
    throw err;
  }

  s.stop();

  // Step 2: Check if we have any data
  if (payload.days.length === 0) {
    console.log(chalk.yellow("No usage data found."));
    if (options.since) {
      console.log(chalk.dim(`No data available since ${options.since}.`));
    }
    return;
  }

  // Step 3: Calculate and display summary
  const totalTokens = payload.days.reduce(
    (sum, day) =>
      sum +
      day.inputTokens +
      day.outputTokens +
      day.cacheCreationTokens +
      day.cacheReadTokens,
    0
  );
  const totalCost = payload.days.reduce(
    (sum, day) => sum + day.totalCost,
    0
  );

  console.log(
    `Found ${chalk.bold(String(payload.days.length))} days of data (${chalk.bold(
      formatTokens(totalTokens)
    )} tokens, ${chalk.bold(`$${totalCost.toFixed(2)}`)})`
  );

  // Step 4: Dry run -- display summary and exit
  if (options.dryRun) {
    const bySource = payload.days.reduce<Record<string, { days: number; tokens: number; cost: number }>>(
      (acc, day) => {
        const key = day.source ?? "unknown";
        const tokens =
          day.inputTokens +
          day.outputTokens +
          day.cacheCreationTokens +
          day.cacheReadTokens;
        if (!acc[key]) acc[key] = { days: 0, tokens: 0, cost: 0 };
        acc[key].days += 1;
        acc[key].tokens += tokens;
        acc[key].cost += day.totalCost;
        return acc;
      },
      {}
    );
    console.log(chalk.dim("\nPer-source breakdown:"));
    for (const [src, agg] of Object.entries(bySource)) {
      console.log(
        chalk.dim(
          `  ${src}: ${agg.days} day(s), ${formatTokens(agg.tokens)} tokens, $${agg.cost.toFixed(2)}`
        )
      );
    }
    console.log(chalk.dim("\nDry run -- data was not uploaded."));
    return;
  }

  // Step 5: Upload to server
  s.start("Uploading to clawdboard...");

  const machineId = await getMachineId();
  const client = new ApiClient(serverUrl, config.apiToken);
  const result = await client.sync({ ...payload, syncIntervalMs: DEBOUNCE_MS, machineId });

  s.stop();

  console.log(
    chalk.green(`Synced ${result.daysUpserted} days of usage data`)
  );

  // Reset debounce timer so hook doesn't immediately re-sync
  await markSynced().catch(() => {});

  console.log(
    `Total: ${formatTokens(totalTokens)} tokens, $${totalCost.toFixed(2)} cost`
  );
}

/**
 * Sync command -- Extract local usage data (Claude Code + OpenCode + Codex), sanitize, and upload.
 *
 * Flow:
 * 1. Load config and check for API token
 * 2. Extract usage data from all available sources
 * 3. Sanitize through privacy allowlist
 * 4. Upload to clawdboard server
 * 5. Display summary with token/cost totals
 */
export const syncCommand = new Command("sync")
  .description("Sync usage data (Claude Code + OpenCode + Codex)")
  .option("--since <date>", "Sync data from this date forward (YYYY-MM-DD)")
  .option("--dry-run", "Extract and display data without uploading")
  .action(async (options: { since?: string; dryRun?: boolean }) => {
    try {
      // Load config and check for API token
      const config = await loadConfig();

      if (!options.dryRun && !config.apiToken) {
        console.error(
          chalk.red("Not authenticated. Run `clawdboard auth` first.")
        );
        process.exit(1);
      }

      await runSync(config, options);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          console.error(
            chalk.red(
              "Authentication expired. Run `clawdboard auth` again."
            )
          );
        } else if (err.status === 413) {
          console.error(
            chalk.red(
              "Too much data. Try `--since YYYY-MM-DD` to limit the range."
            )
          );
        } else if (err.status === 0) {
          console.error(
            chalk.red(
              "Could not reach clawdboard server. Check your connection."
            )
          );
        } else {
          console.error(chalk.red(`Upload failed: ${err.message}`));
        }
      } else if (err instanceof Error) {
        console.error(chalk.red(`Error: ${err.message}`));
      } else {
        console.error(chalk.red("An unexpected error occurred."));
      }
      process.exit(1);
    }
  });

/**
 * Format a large token count with comma separators.
 */
function formatTokens(count: number): string {
  return count.toLocaleString("en-US");
}
