// Your agents: pair a local coding agent and solve through Codelit.
// No API keys live here — the connector on your computer holds your agent
// login; Codelit keeps only a revocable device token.

"use client";
import Link from "next/link";
import NativeConnect from "@/components/NativeConnect";
import NativeSetupGuide from "@/components/NativeSetupGuide";

export default function AgentsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl tracking-tight">Your agents</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">
        Bring your own coding agent — Codex today, Claude next. It runs on your computer with
        your login; Codelit sees only the challenge conversation.{" "}
        <Link href="/native" className="text-[#e8b33d] hover:underline rounded">Solve with my agent →</Link>
      </p>

      <div className="mt-6">
        <NativeConnect />
      </div>
      <NativeSetupGuide />
    </div>
  );
}
