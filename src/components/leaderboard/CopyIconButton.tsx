"use client";

import { CheckIcon, CopyIcon } from "@/components/icons/CommonIcons";
import { useCopyToClipboard } from "@/components/ui/useCopyToClipboard";

export function CopyIconButton({
  text,
  onCopy,
}: {
  text: string;
  onCopy?: () => void;
}) {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = () => {
    copy(text);
    onCopy?.();
  };

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded p-1 text-muted transition-colors hover:text-foreground"
        aria-label="Copy command"
      >
        {copied ? <CheckIcon className="text-green-400" /> : <CopyIcon />}
      </button>
      {copied && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground shadow-lg animate-[tooltipIn_150ms_ease-out]">
          Copied! Paste it in your terminal
        </span>
      )}
    </span>
  );
}
