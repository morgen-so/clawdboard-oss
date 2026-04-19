import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  stripLegacyHookBlock,
  ensureCodexHooksFeature,
  upsertClawdboardStopHook,
  installCodexHook,
  isCodexHookInstalled,
  type CodexHooksFile,
} from "../src/codex-setup.js";

describe("stripLegacyHookBlock", () => {
  it("returns input unchanged when no marker present", () => {
    const src = '[some]\nkey = "value"\n';
    expect(stripLegacyHookBlock(src)).toBe(src);
  });

  it("removes marker + [[hooks.Stop]] + inline hooks line", () => {
    const src = [
      "[something]",
      "x = 1",
      "",
      "# clawdboard auto-sync",
      "[[hooks.Stop]]",
      'hooks = [{ type = "command", command = "bash -c \'f=X\'", timeout = 120 }]',
      "",
      "[other]",
      "y = 2",
      "",
    ].join("\n");

    const out = stripLegacyHookBlock(src);
    expect(out).not.toContain("clawdboard auto-sync");
    expect(out).not.toContain("[[hooks.Stop]]");
    expect(out).not.toMatch(/^hooks = /m);
    expect(out).toContain("[something]");
    expect(out).toContain("x = 1");
    expect(out).toContain("[other]");
    expect(out).toContain("y = 2");
  });

  it("does not strip [[hooks.Stop]] blocks the user wrote themselves", () => {
    const src = [
      "[[hooks.Stop]]",
      'hooks = [{ type = "command", command = "echo user-hook" }]',
      "",
    ].join("\n");
    expect(stripLegacyHookBlock(src)).toBe(src);
  });

  it("preserves user-authored [[hooks.*]] sections that follow the legacy block", () => {
    const src = [
      "# clawdboard auto-sync",
      "[[hooks.Stop]]",
      'hooks = [{ type = "command", command = "clawdboard-legacy", timeout = 120 }]',
      "",
      "[[hooks.PreToolUse]]",
      'hooks = [{ type = "command", command = "echo user-pre" }]',
      "",
      "[[hooks.SessionStart]]",
      'hooks = [{ type = "command", command = "echo user-start" }]',
      "",
    ].join("\n");

    const out = stripLegacyHookBlock(src);
    expect(out).not.toContain("clawdboard-legacy");
    expect(out).not.toContain("# clawdboard auto-sync");
    expect(out).toContain("[[hooks.PreToolUse]]");
    expect(out).toContain("echo user-pre");
    expect(out).toContain("[[hooks.SessionStart]]");
    expect(out).toContain("echo user-start");
  });

  it("strips only the marker line when the legacy shape doesn't match", () => {
    // User hand-edited the file — marker comment is orphaned, no [[hooks.Stop]]
    // follows. We remove just the stale comment and leave their content alone.
    const src = [
      "# clawdboard auto-sync",
      "",
      "[model]",
      'name = "gpt-5"',
      "",
    ].join("\n");

    const out = stripLegacyHookBlock(src);
    expect(out).not.toContain("# clawdboard auto-sync");
    expect(out).toContain("[model]");
    expect(out).toContain('name = "gpt-5"');
  });

  it("preserves a top-level `hooks = ...` assignment the user wrote", () => {
    // After the legacy block has been cleaned, a user-authored top-level
    // `hooks = ...` line further down must survive. (Previous implementation
    // ate any line starting with `hooks = ` while in skip mode.)
    const src = [
      "# clawdboard auto-sync",
      "[[hooks.Stop]]",
      'hooks = [{ type = "command", command = "legacy", timeout = 120 }]',
      "",
      "[user]",
      'hooks = "my-value"',
      "",
    ].join("\n");

    const out = stripLegacyHookBlock(src);
    expect(out).not.toContain("legacy");
    expect(out).toContain("[user]");
    expect(out).toContain('hooks = "my-value"');
  });

  it("heals the real-world broken TOML from the bug report", () => {
    // Reproduces alaa's config exactly (unescaped quotes inside TOML string).
    const broken = [
      "",
      "",
      "# clawdboard auto-sync",
      "[[hooks.Stop]]",
      'hooks = [{ type = "command", command = "bash -c \'f=$HOME/.clawdboard/last-sync; [ -f "$f" ] && [ -n "$(find "$f" -mmin -120 2>/dev/null)" ] && exit 0; if command -v clawdboard >/dev/null 2>&1; then clawdboard hook-sync; else npx -y clawdboard hook-sync; fi\'", timeout = 120 }]',
      "",
    ].join("\n");

    const out = stripLegacyHookBlock(broken);
    expect(out).not.toContain("clawdboard");
    expect(out).not.toContain("$f");
    expect(out).not.toContain("[[hooks.Stop]]");
  });
});

describe("ensureCodexHooksFeature", () => {
  it("adds [features] table when the file is empty", () => {
    const out = ensureCodexHooksFeature("");
    expect(out).toBe("[features]\ncodex_hooks = true\n");
  });

  it("appends [features] table when the file has other content", () => {
    const src = 'model = "gpt-5"\n';
    const out = ensureCodexHooksFeature(src);
    expect(out).toContain('model = "gpt-5"');
    expect(out).toMatch(/\[features\]\ncodex_hooks = true/);
  });

  it("inserts under existing [features] header", () => {
    const src = "[features]\napps = true\n";
    const out = ensureCodexHooksFeature(src);
    expect(out).toMatch(/\[features\]\ncodex_hooks = true\napps = true/);
  });

  it("is idempotent when codex_hooks = true already present", () => {
    const src = "[features]\ncodex_hooks = true\n";
    expect(ensureCodexHooksFeature(src)).toBe(src);
  });

  it("respects explicit codex_hooks = false (does not overwrite)", () => {
    const src = "[features]\ncodex_hooks = false\n";
    expect(ensureCodexHooksFeature(src)).toBe(src);
  });

  it("preserves unrelated tables", () => {
    const src = '[model]\nname = "o1"\n\n[features]\napps = true\n';
    const out = ensureCodexHooksFeature(src);
    expect(out).toContain("[model]");
    expect(out).toContain('name = "o1"');
    expect(out).toMatch(/\[features\]\ncodex_hooks = true\napps = true/);
  });
});

describe("upsertClawdboardStopHook", () => {
  it("adds Stop hook to empty config with the correct shape", () => {
    const out = upsertClawdboardStopHook({});
    expect(out.hooks?.Stop).toHaveLength(1);
    const hook = out.hooks!.Stop![0].hooks[0];
    expect(hook.type).toBe("command");
    expect(hook.command).toContain("clawdboard");
    expect(hook.command).toContain("mmin -120");
    expect(hook.timeout).toBe(120);
  });

  it("does not emit async (codex skips async hooks)", () => {
    const out = upsertClawdboardStopHook({});
    const hook = out.hooks!.Stop![0].hooks[0] as Record<string, unknown>;
    expect(hook.async).toBeUndefined();
  });

  it("replaces existing clawdboard Stop hook rather than duplicating", () => {
    const first = upsertClawdboardStopHook({});
    const second = upsertClawdboardStopHook(first);
    expect(second.hooks?.Stop).toHaveLength(1);
    expect(second.hooks?.Stop?.[0].hooks).toHaveLength(1);
  });

  it("preserves hooks on other events", () => {
    const existing: CodexHooksFile = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo pre" }] }],
      },
    };
    const out = upsertClawdboardStopHook(existing);
    expect(out.hooks?.PreToolUse?.[0].hooks[0].command).toBe("echo pre");
    expect(out.hooks?.Stop).toHaveLength(1);
  });

  it("preserves non-clawdboard Stop hooks", () => {
    const existing: CodexHooksFile = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo other" }] }],
      },
    };
    const out = upsertClawdboardStopHook(existing);
    expect(out.hooks?.Stop).toHaveLength(2);
    expect(out.hooks?.Stop?.[0].hooks[0].command).toBe("echo other");
    expect(out.hooks?.Stop?.[1].hooks[0].command).toContain("clawdboard");
  });

  it("round-trips through JSON.stringify with embedded double quotes", () => {
    const out = upsertClawdboardStopHook({});
    const parsed = JSON.parse(JSON.stringify(out)) as CodexHooksFile;
    expect(parsed.hooks?.Stop?.[0].hooks[0].command).toBe(
      out.hooks?.Stop?.[0].hooks[0].command
    );
    // The serialized JSON should contain the escaped double-quote sequence
    // (this is the core of the bug — JSON escapes safely, TOML basic strings did not).
    expect(JSON.stringify(out)).toContain('\\"$f\\"');
  });
});

describe("installCodexHook (integration)", () => {
  let testHome: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    testHome = join(
      tmpdir(),
      `clawdboard-codex-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testHome, { recursive: true });
    process.env.HOME = testHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    rmSync(testHome, { recursive: true, force: true });
  });

  it("fresh install writes valid hooks.json and feature flag", async () => {
    const result = await installCodexHook();
    expect(result.installed).toBe(true);
    expect(result.alreadyInstalled).toBe(false);

    const hooksPath = join(testHome, ".codex", "hooks.json");
    const configPath = join(testHome, ".codex", "config.toml");
    expect(existsSync(hooksPath)).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as CodexHooksFile;
    expect(hooks.hooks?.Stop?.[0].hooks[0].command).toContain("clawdboard");
    expect(hooks.hooks?.Stop?.[0].hooks[0].type).toBe("command");

    expect(readFileSync(configPath, "utf-8")).toContain("codex_hooks = true");
    expect(isCodexHookInstalled()).toBe(true);
  });

  it("is idempotent on second run", async () => {
    await installCodexHook();
    const result = await installCodexHook();
    expect(result.alreadyInstalled).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.updated).toBe(false);
  });

  it("heals the legacy broken config.toml block", async () => {
    const codexDir = join(testHome, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const configPath = join(codexDir, "config.toml");
    writeFileSync(
      configPath,
      [
        'model = "gpt-5"',
        "",
        "# clawdboard auto-sync",
        "[[hooks.Stop]]",
        'hooks = [{ type = "command", command = "bash -c \'f=$HOME/.clawdboard/last-sync; [ -f "$f" ] && exit 0; fi\'", timeout = 120 }]',
        "",
      ].join("\n"),
      "utf-8"
    );

    const result = await installCodexHook();
    expect(result.updated).toBe(true);

    const configAfter = readFileSync(configPath, "utf-8");
    expect(configAfter).toContain('model = "gpt-5"');
    expect(configAfter).toContain("codex_hooks = true");
    expect(configAfter).not.toContain("# clawdboard auto-sync");
    expect(configAfter).not.toContain("[[hooks.Stop]]");
    // The unescaped shell command no longer lives in config.toml.
    expect(configAfter).not.toContain("$f");
    expect(configAfter).not.toContain("bash -c");

    const hooks = JSON.parse(
      readFileSync(join(codexDir, "hooks.json"), "utf-8")
    ) as CodexHooksFile;
    expect(hooks.hooks?.Stop?.[0].hooks[0].command).toContain("clawdboard");
  });

  it("preserves pre-existing hooks.json entries on other events", async () => {
    const codexDir = join(testHome, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const hooksPath = join(codexDir, "hooks.json");
    writeFileSync(
      hooksPath,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              { hooks: [{ type: "command", command: "echo pre-existing" }] },
            ],
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    await installCodexHook();
    const hooks = JSON.parse(readFileSync(hooksPath, "utf-8")) as CodexHooksFile;
    expect(hooks.hooks?.PreToolUse?.[0].hooks[0].command).toBe("echo pre-existing");
    expect(hooks.hooks?.Stop?.[0].hooks[0].command).toContain("clawdboard");
  });

  it("preserves existing [features] keys when adding codex_hooks", async () => {
    const codexDir = join(testHome, ".codex");
    mkdirSync(codexDir, { recursive: true });
    const configPath = join(codexDir, "config.toml");
    writeFileSync(configPath, "[features]\napps = true\n", "utf-8");

    await installCodexHook();
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("apps = true");
    expect(content).toContain("codex_hooks = true");
  });

  it("writes TOML with no embedded shell command (prevents the bug recurring)", async () => {
    await installCodexHook();
    const content = readFileSync(
      join(testHome, ".codex", "config.toml"),
      "utf-8"
    );
    expect(content).not.toContain("bash -c");
    expect(content).not.toContain("$f");
    expect(content).not.toContain("[[hooks.Stop]]");
  });
});
