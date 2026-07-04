"use client";

import { useState } from "react";

/** A code/prompt block with a one-click copy button (arcade-skinned). */
export function CopyBlock({
  text,
  variant = "green",
}: {
  text: string;
  variant?: "green" | "cyan";
}) {
  const [copied, setCopied] = useState(false);
  const border = variant === "cyan" ? "pixel-box--cyan" : "pixel-box--green";
  const ink =
    variant === "cyan" ? "text-[var(--pg-cyan)]" : "text-[var(--pg-green)]";

  return (
    <div className="relative">
      <pre
        className={`pixel-box ${border} overflow-x-auto whitespace-pre-wrap break-words p-4 pr-16 text-xs ${ink}`}
      >
        {text}
      </pre>
      <button
        type="button"
        className="pixel-btn absolute top-2 right-2 text-[0.5rem]"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "copied ✓" : "copy"}
      </button>
    </div>
  );
}
