import { readFile, writeFile, mkdir, copyFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Configuration for the clawdboard CLI.
 * Stored at ~/.clawdboard/config.json.
 */
export interface Config {
  apiToken?: string;
  serverUrl?: string;
}

const CONFIG_DIR = join(homedir(), ".clawdboard");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

// Legacy path for migration from ccboard → clawdboard
const OLD_CONFIG_DIR = join(homedir(), ".ccboard");
const OLD_CONFIG_PATH = join(OLD_CONFIG_DIR, "config.json");

const DEFAULT_SERVER_URL = "https://clawdboard.ai";

// The config file stores a plaintext API token; restrict access to the
// owning user. Also tightens pre-existing loose perms on upgrade —
// writeFile/mkdir mode options only apply to newly created inodes, so
// existing installs with 0o755/0o644 wouldn't converge otherwise.
// chmod is a no-op on Windows (uses ACLs instead).
async function tightenPerms(): Promise<void> {
  if (process.platform === "win32") return;
  await Promise.all([
    chmod(CONFIG_DIR, CONFIG_DIR_MODE).catch(() => {}),
    chmod(CONFIG_PATH, CONFIG_FILE_MODE).catch(() => {}),
  ]);
}

/**
 * Load config from ~/.clawdboard/config.json.
 * Returns defaults if the file does not exist.
 */
export async function loadConfig(): Promise<Config> {
  // Migrate from ~/.ccboard/ if new config doesn't exist yet
  if (!existsSync(CONFIG_PATH) && existsSync(OLD_CONFIG_PATH)) {
    await mkdir(CONFIG_DIR, { recursive: true, mode: CONFIG_DIR_MODE });
    await copyFile(OLD_CONFIG_PATH, CONFIG_PATH);
  }

  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Config;
    await tightenPerms();
    return parsed;
  } catch {
    // File doesn't exist or is malformed -- return defaults
    return {};
  }
}

/**
 * Save config to ~/.clawdboard/config.json.
 * Creates the ~/.clawdboard/ directory if it doesn't exist.
 */
export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: CONFIG_DIR_MODE });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    mode: CONFIG_FILE_MODE,
  });
  await tightenPerms();
}

/**
 * Get the server URL from config, environment variable, or default.
 * Priority: CLAWDBOARD_SERVER_URL env var > config.serverUrl > default
 */
export function getServerUrl(config?: Config): string {
  return (
    process.env.CLAWDBOARD_SERVER_URL ??
    config?.serverUrl ??
    DEFAULT_SERVER_URL
  );
}
