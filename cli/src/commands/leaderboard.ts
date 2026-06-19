import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, getServerUrl } from "../config.js";
import { ApiClient } from "../api-client.js";

const VALID_PERIODS = ["today", "7d", "30d", "this-month", "ytd"];

export const leaderboardCommand = new Command("leaderboard")
  .description("Show the top users on the leaderboard")
  .option("-n, --limit <number>", "Number of users to show (1-50)", "10")
  .option(
    "-p, --period <period>",
    `Time period: ${VALID_PERIODS.join(", ")}`,
    "7d"
  )
  .action(async (opts: { limit: string; period: string }) => {
    const limit = parseInt(opts.limit, 10);
    if (isNaN(limit) || limit < 1 || limit > 50) {
      console.error(chalk.red("--limit must be a number between 1 and 50"));
      process.exit(1);
    }
    if (!VALID_PERIODS.includes(opts.period)) {
      console.error(
        chalk.red(`--period must be one of: ${VALID_PERIODS.join(", ")}`)
      );
      process.exit(1);
    }

    const config = await loadConfig();
    const serverUrl = getServerUrl(config);
    const client = new ApiClient(serverUrl, config.apiToken);

    const spinner = ora("Fetching leaderboard…").start();

    try {
      const data = await client.getLeaderboard({
        limit,
        period: opts.period,
      });

      spinner.stop();

      console.log("");
      console.log(chalk.bold(`  clawdboard leaderboard (${data.period})`));
      console.log("");

      // Header
      console.log(
        chalk.gray(
          "  #   User                   Cost        Tokens       Days  Streak"
        )
      );
      console.log(chalk.gray("  " + "─".repeat(68)));

      for (const entry of data.entries) {
        const rank = String(entry.rank).padStart(2);
        const name = (entry.username ?? "anonymous").padEnd(20);
        const cost = `$${parseFloat(entry.totalCost).toFixed(2)}`.padStart(10);
        const tokens = formatTokens(entry.totalTokens).padStart(12);
        const days = String(entry.activeDays).padStart(5);
        const streak = String(entry.streak).padStart(6);

        console.log(`  ${chalk.cyan(rank)}  ${chalk.white(name)} ${chalk.yellow(cost)} ${tokens} ${days} ${streak}`);
      }

      console.log("");
    } catch (err) {
      spinner.fail("Failed to fetch leaderboard");
      if (err instanceof Error) {
        console.error(chalk.red(err.message));
      }
      process.exit(1);
    }
  });

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
