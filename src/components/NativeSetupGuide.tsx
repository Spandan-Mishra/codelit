"use client";

import { useState } from "react";
import { Check, Copy, TerminalSquare } from "lucide-react";

export function NativeCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setError("");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Select and copy the command manually.");
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-start gap-3 rounded-lg border border-[#3a3c37] bg-black/40 p-3">
        <code className="min-w-0 flex-1 break-all font-code text-xs leading-6 text-[#ece9e2]">{command}</code>
        <button type="button" onClick={() => void copy()} aria-label={copied ? "Command copied" : "Copy command"} className="shrink-0 rounded p-1 text-[#b3afa3] hover:text-white">
          {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p role="status" className="mt-1 text-xs text-[#b3afa3]">{error || (copied ? "Copied to clipboard" : "Paste into a terminal on the computer where your agent is installed.")}</p>
    </div>
  );
}

// Each stage is shown only when it is actionable. Pairing exits; run is a
// separate process, so the UI must never describe a claimed code as online.
export default function NativeSetupGuide({
  step,
  origin,
  code,
}: {
  step: "install" | "pair" | "run";
  origin: string;
  code?: string;
}) {
  const command = step === "install"
    ? `npm install --global '${origin}/api/native/connector'`
    : step === "pair"
      ? `codelit-connect pair --relay '${origin}' --code ${code}`
      : `codelit-connect run --relay '${origin}'`;

  return (
    <div className="font-ui text-sm leading-6">
      <p className="flex items-center gap-2 font-semibold text-[#ece9e2]">
        <TerminalSquare className="h-4 w-4 text-[#e8b33d]" />
        {step === "install" ? "1. Install the connector once" : step === "pair" ? "2. Pair this browser with your computer" : "3. Bring the connector online"}
      </p>
      <p className="mt-2 text-[#b3afa3]">
        {step === "install"
          ? "Requires Node.js 22+ with npm and your agent CLI. This installs Codelit’s connector command from this site. It does not install an agent or sign you into a provider."
          : step === "pair"
            ? "This command asks you to confirm the shared challenge data, then saves a revocable device credential in ~/.codelit/device.json. Your provider credentials stay in your local agent."
            : "This starts the relay in this terminal. It checks your local providers, receives challenge commands, and returns agent replies, tool activity, and solution changes to Codelit. Keep it running while solving; Ctrl-C stops it."}
      </p>
      {step === "pair" && (
        <div className="mt-3 rounded-lg border border-[#3a3c37] bg-black/20 p-3 text-xs leading-5 text-[#b3afa3]">
          <p className="font-semibold text-[#ece9e2]">Why a terminal command instead of a button?</p>
          <p className="mt-1">Your browser cannot reach programs on your computer, so this one terminal step proves the connector runs where your agent and its login live. What the command does: it sends your one-time code to this site, shows you exactly what challenge data Codelit will exchange, and — only after you confirm — saves a revocable device credential in <code className="font-code">~/.codelit/device.json</code>. Your provider login never leaves your machine, and you can revoke the credential here at any time.</p>
        </div>
      )}
      {origin && (step !== "pair" || code) ? <NativeCommand command={command} /> : <p className="mt-3 text-[#b3afa3]">Preparing command…</p>}
      {step === "install" && (
        <details className="mt-4 text-xs text-[#b3afa3]">
          <summary className="cursor-pointer text-[#ece9e2]">Need the agent or Node.js first?</summary>
          <p className="mt-2">Install <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer" className="text-[#e8b33d] underline underline-offset-4">Node.js 22 or newer</a>, then install and sign into your coding agent on this computer. For Codex, run <code className="font-code">codex login</code>. A Claude CLI installation is detected, but this connector does not yet support Claude solving.</p>
          <p className="mt-2">No project checkout is required. Already have the connector? Skip this step below.</p>
        </details>
      )}
      {step === "run" && <p className="mt-3 text-xs text-[#b3afa3]">If a provider needs attention, follow its message below, then restart the connector. Pairing again is only needed after revoking a device or changing browsers.</p>}
    </div>
  );
}
