import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAWDBOARD_DIR = join(homedir(), ".clawdboard");
const MACHINE_ID_PATH = join(CLAWDBOARD_DIR, "machine-id");

/**
 * Get a stable, persistent machine identifier.
 *
 * On first call, generates a random UUID and persists it to
 * ~/.clawdboard/machine-id. Subsequent calls return the stored value.
 *
 * Uses a random UUID rather than hostname-derived hash because default
 * hostnames (e.g. "MacBook-Pro") are common across machines and would
 * collide, defeating the purpose of per-machine tracking.
 */
export async function getMachineId(): Promise<string> {
  // Return persisted ID if it exists
  if (existsSync(MACHINE_ID_PATH)) {
    const stored = (await readFile(MACHINE_ID_PATH, "utf-8")).trim();
    if (stored.length > 0) return stored;
  }

  // Generate a random UUID
  const machineId = randomUUID();

  // Persist
  await mkdir(CLAWDBOARD_DIR, { recursive: true });
  await writeFile(MACHINE_ID_PATH, machineId + "\n", "utf-8");

  return machineId;
}
