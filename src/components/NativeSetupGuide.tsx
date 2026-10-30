// Step-by-step setup for running your own coding agent with Codelit.
// Copy-paste commands, requirements up front, troubleshooting at the end.

"use client";
import { useState } from "react";
import { Check, Copy, TerminalSquare, UserRound, Rocket, LifeBuoy } from "lucide-react";

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md bg-black/50 border border-[#3a3c37] px-3 py-2">
      <code className="flex-1 min-w-0 font-code text-[13px] text-[#e8e4d8] break-all">{children}</code>
      <button onClick={() => void copy()} aria-label="Copy command" className="text-[#9a968c] hover:text-white shrink-0 mt-0.5">
        {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

const relayHint =
  typeof window !== "undefined" ? window.location.origin : "https://your-codelit-host";

export default function NativeSetupGuide() {
  return (
    <div className="mt-6 rounded-lg border border-[#262824] bg-[#141613] p-5">
      <p className="font-semibold flex items-center gap-2">
        <TerminalSquare className="h-4 w-4 text-[#e8b33d]" /> Set up your agent in 5 minutes
      </p>

      <ol className="mt-4 space-y-5 font-ui text-sm leading-6">
        <li>
          <p><strong className="text-white">1. Install the prerequisites.</strong> <span className="text-[#9a968c]">Node 22+ and one agent CLI:</span></p>
          <Cmd>node --version && codex --version</Cmd>
          <p className="text-[#9a968c] mt-1">Need Codex? See <span className="font-code text-[13px]">developers.openai.com/codex</span>. Claude support is coming — the connector already detects it.</p>
        </li>
        <li>
          <p><strong className="text-white">2. Sign in to your agent.</strong> <span className="text-[#9a968c]">Your login stays on your machine — Codelit never sees it:</span></p>
          <Cmd>codex login</Cmd>
        </li>
        <li>
          <p><strong className="text-white flex items-center gap-1.5"><UserRound className="h-4 w-4" /> 3. Install the connector command.</strong> <span className="text-[#9a968c]">It lives in the Codelit repo — this puts <span className="font-code text-[13px]">codelit-connect</span> on your PATH:</span></p>
          <Cmd>cd codelit/connector && ./install.sh</Cmd>
          <p className="text-[#9a968c] mt-1">No npm? Run it directly instead: <span className="font-code text-[13px]">node bin/codelit-connect.mjs …</span> from that folder.</p>
        </li>
        <li>
          <p><strong className="text-white">4. Pair this machine.</strong> <span className="text-[#9a968c]">Click “Pair a new device” above, then enter the one-time code here:</span></p>
          <Cmd>{`codelit-connect pair --relay ${relayHint} --code PASTE_CODE_HERE`}</Cmd>
        </li>
        <li>
          <p><strong className="text-white flex items-center gap-1.5"><Rocket className="h-4 w-4" /> 5. Start the relay and solve.</strong></p>
          <Cmd>{`codelit-connect run --relay ${relayHint}`}</Cmd>
          <p className="text-[#9a968c] mt-1">Keep it running, then open <span className="text-[#e8b33d]">Solve with my agent</span> and pick a scenario. Chat, approvals, and edits stay in Codelit; only your frozen solution is graded.</p>
        </li>
      </ol>

      <div className="mt-5 rounded-md bg-black/40 border border-[#262824] p-4">
        <p className="text-sm font-semibold flex items-center gap-2"><LifeBuoy className="h-4 w-4 text-[#e8b33d]" /> If something breaks</p>
        <ul className="mt-2 space-y-1.5 text-[13px] text-[#9a968c] leading-6 list-disc pl-5">
          <li><span className="text-[#c9c5ba]">Code expired</span> — codes are single-use and last 10 minutes. Create a new one.</li>
          <li><span className="text-[#c9c5ba]">Device rejected</span> — it was revoked on this page. Re-pair to continue.</li>
          <li><span className="text-[#c9c5ba]">Agent silent</span> — is the relay still running? Restart it; the session resumes without resending your last prompt.</li>
          <li><span className="text-[#c9c5ba]">Approval stuck</span> — answer it here; ignored requests expire after 5 minutes and never auto-approve.</li>
          <li><span className="text-[#c9c5ba]">“Prompt budget exhausted”</span> — each attempt has a fixed prompt allowance. Finish or start fresh.</li>
        </ul>
      </div>
    </div>
  );
}
