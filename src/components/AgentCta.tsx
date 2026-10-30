"use client";
import Link from "next/link";
import { Bot } from "lucide-react";

export default function AgentCta() {
  return (
    <section className="py-8">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Bot className="h-5 w-5 text-[#e8b33d]" />
        <h2 className="text-xl sm:text-2xl tracking-tight">Bring your own agent</h2>
      </div>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">
        Pair your own coding agent and solve scenarios with it — chat, edits, and approvals stay in Codelit.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/native"
          className="inline-block font-ui text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black font-semibold"
        >
          Solve with my agent →
        </Link>
        <Link
          href="/agents"
          className="inline-block font-ui text-sm px-4 py-2 rounded-md border border-[#3a3c37] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]"
        >
          Setup guide →
        </Link>
      </div>
    </section>
  );
}
