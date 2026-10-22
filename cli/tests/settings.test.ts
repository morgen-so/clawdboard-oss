import { describe, it, expect } from "vitest";
import { installHook } from "../src/settings.js";
import { DEBOUNCE_MINUTES } from "../src/hook.js";
import type { ClaudeSettings } from "../src/settings.js";

describe("installHook", () => {
  it("fresh install: adds hook to Stop event", () => {
    const settings: ClaudeSettings = {};
    const result = installHook(settings);

    expect(result.alreadyInstalled).toBe(false);
    expect(result.migrated).toBe(false);
    expect(result.settings.hooks?.Stop).toHaveLength(1);
    expect(result.settings.hooks?.Stop?.[0].hooks[0].command).toContain(
      "clawdboard hook-sync"
    );
    expect(result.settings.hooks?.Stop?.[0].hooks[0].command).toContain(
      "find"
    );
    // Should not have PostToolUse
    expect(result.settings.hooks?.PostToolUse).toBeUndefined();
  });

  it("rewrites a Stop hook built with an older sync interval", () => {
    const settings: ClaudeSettings = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "bash -c 'f=$HOME/.clawdboard/last-sync; [ -f \"$f\" ] && [ -n \"$(find \"$f\" -mmin -120 2>/dev/null)\" ] && exit 0; npx -y clawdboard hook-sync'",
                async: true,
                timeout: 120,
              },
            ],
          },
        ],
      },
    };
    const result = installHook(settings);

    expect(result.alreadyInstalled).toBe(false);
    expect(result.settings.hooks?.Stop).toHaveLength(1);
    expect(result.settings.hooks?.Stop?.[0].hooks[0].command).toContain(
      `-mmin -${DEBOUNCE_MINUTES}`
    );
  });

  it("idempotent: does not duplicate if already installed on Stop", () => {
    const settings: ClaudeSettings = {};
    const first = installHook(settings);
    const second = installHook(first.settings);

    expect(second.alreadyInstalled).toBe(true);
    expect(second.settings.hooks?.Stop).toHaveLength(1);
  });

  it("migrates legacy ccboard hook from PostToolUse to Stop", () => {
    const settings: ClaudeSettings = {
      hooks: {
        PostToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: "npx ccboard hook-sync",
                async: true,
                timeout: 120,
              },
            ],
          },
        ],
      },
    };
    const result = installHook(settings);

    expect(result.alreadyInstalled).toBe(false);
    expect(result.migrated).toBe(true);
    expect(result.settings.hooks?.Stop).toHaveLength(1);
    expect(result.settings.hooks?.Stop?.[0].hooks[0].command).toContain(
      "clawdboard"
    );
    // PostToolUse should be cleaned up
    expect(result.settings.hooks?.PostToolUse).toBeUndefined();
  });

  it("upgrades old clawdboard hook from PostToolUse to Stop", () => {
    const settings: ClaudeSettings = {
      hooks: {
        PostToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: "npx clawdboard hook-sync",
                async: true,
                timeout: 120,
              },
            ],
          },
        ],
      },
    };
    const result = installHook(settings);

    expect(result.alreadyInstalled).toBe(false);
    expect(result.settings.hooks?.Stop).toHaveLength(1);
    expect(result.settings.hooks?.Stop?.[0].hooks[0].command).toContain(
      "find"
    );
    // Old PostToolUse hook should be removed
    expect(result.settings.hooks?.PostToolUse).toBeUndefined();
  });

  it("upgrades shell-debounced PostToolUse hook to Stop", () => {
    const settings: ClaudeSettings = {
      hooks: {
        PostToolUse: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "bash -c 'f=$HOME/.clawdboard/last-sync; [ -f \"$f\" ] && [ -n \"$(find \"$f\" -mmin -120 2>/dev/null)\" ] && exit 0; npx clawdboard hook-sync'",
                async: true,
                timeout: 120,
              },
            ],
          },
        ],
      },
    };
    const result = installHook(settings);

    expect(result.alreadyInstalled).toBe(false);
    expect(result.settings.hooks?.Stop).toHaveLength(1);
    expect(result.settings.hooks?.PostToolUse).toBeUndefined();
  });

  it("preserves other PostToolUse hooks during migration", () => {
    const otherHook = {
      hooks: [
        {
          type: "command" as const,
          command: "echo other-hook",
        },
      ],
    };
    const settings: ClaudeSettings = {
      hooks: {
        PostToolUse: [
          otherHook,
          {
            hooks: [
              {
                type: "command",
                command: "npx clawdboard hook-sync",
                async: true,
                timeout: 120,
              },
            ],
          },
        ],
      },
    };
    const result = installHook(settings);

    expect(result.settings.hooks?.Stop).toHaveLength(1);
    // Other hook should be preserved
    expect(result.settings.hooks?.PostToolUse).toHaveLength(1);
    expect(result.settings.hooks?.PostToolUse?.[0].hooks[0].command).toBe(
      "echo other-hook"
    );
  });

  it("preserves existing Stop hooks from other tools", () => {
    const otherStopHook = {
      hooks: [
        {
          type: "command" as const,
          command: "echo some-other-stop-hook",
        },
      ],
    };
    const settings: ClaudeSettings = {
      hooks: {
        Stop: [otherStopHook],
      },
    };
    const result = installHook(settings);

    expect(result.settings.hooks?.Stop).toHaveLength(2);
    expect(result.settings.hooks?.Stop?.[0].hooks[0].command).toBe(
      "echo some-other-stop-hook"
    );
    expect(result.settings.hooks?.Stop?.[1].hooks[0].command).toContain(
      "clawdboard"
    );
  });

  it("preserves other settings keys (permissions, statusLine, etc.)", () => {
    const settings: ClaudeSettings = {
      permissions: { allow: ["Read"] },
      statusLine: true,
    };
    const result = installHook(settings);

    expect(result.settings.permissions).toEqual({ allow: ["Read"] });
    expect(result.settings.statusLine).toBe(true);
  });
});

