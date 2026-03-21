import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAWDBOARD_DIR = join(homedir(), ".clawdboard");
const MACHINE_ID_PATH = join(CLAWDBOARD_DIR, "machine-id");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Get a stable, persistent machine identifier.
 *
 * On first call, generates a random UUID and persists it to
 * ~/.clawdboard/machine-id. Subsequent calls return the stored value.
 *
 * Uses a random UUID rather than hostname-derived hash because default
 * hostnames (e.g. "MacBook-Pro") are common across machines and would
 * collide, defeating the purpose of per-machine tracking.
 *
 * Returns undefined if the machine ID cannot be read or persisted,
 * so callers can fall back to syncing without per-machine tracking.
 */
export async function getMachineId(): Promise<string | undefined> {
  try {
    try {
      const stored = (await readFile(MACHINE_ID_PATH, "utf-8")).trim();
      if (UUID_RE.test(stored)) return stored;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    const machineId = randomUUID();
    await mkdir(CLAWDBOARD_DIR, { recursive: true });
    await writeFile(MACHINE_ID_PATH, machineId + "\n", "utf-8");
    return machineId;
  } catch {
    return undefined;
  }
}
