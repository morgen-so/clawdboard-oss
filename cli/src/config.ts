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
  /**
   * Antigravity sync settings. Off by default.
   * `enable` is set via `clawdboard antigravity enable` after the user
   * acknowledges that the CLI will read ~/.gemini/oauth_creds.json and
   * make outbound HTTPS calls to cloudcode-pa.googleapis.com.
   */
  antigravity?: {
    enabled?: boolean;
  };
}

const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

// Resolve config paths lazily so tests (and shells) can override HOME/CLAWDBOARD_HOME
// without needing to re-import this module.
function getConfigDir(): string {
  if (process.env.CLAWDBOARD_HOME) return process.env.CLAWDBOARD_HOME;
  return join(homedir(), ".clawdboard");
}
function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}
function getOldConfigPath(): string {
  // Legacy path for migration from ccboard → clawdboard
  return join(homedir(), ".ccboard", "config.json");
}

const DEFAULT_SERVER_URL = "https://clawdboard.ai";

// The config file stores a plaintext API token; restrict access to the
// owning user. Also tightens pre-existing loose perms on upgrade —
// writeFile/mkdir mode options only apply to newly created inodes, so
// existing installs with 0o755/0o644 wouldn't converge otherwise.
// chmod is a no-op on Windows (uses ACLs instead).
async function tightenPerms(): Promise<void> {
  if (process.platform === "win32") return;
  await Promise.all([
    chmod(getConfigDir(), CONFIG_DIR_MODE).catch(() => {}),
    chmod(getConfigPath(), CONFIG_FILE_MODE).catch(() => {}),
  ]);
}

/**
 * Load config from ~/.clawdboard/config.json.
 * Returns defaults if the file does not exist.
 */
export async function loadConfig(): Promise<Config> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const oldConfigPath = getOldConfigPath();

  // Migrate from ~/.ccboard/ if new config doesn't exist yet
  if (!existsSync(configPath) && existsSync(oldConfigPath)) {
    await mkdir(configDir, { recursive: true, mode: CONFIG_DIR_MODE });
    await copyFile(oldConfigPath, configPath);
  }

  try {
    const raw = await readFile(configPath, "utf-8");
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
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  await mkdir(configDir, { recursive: true, mode: CONFIG_DIR_MODE });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", {
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
