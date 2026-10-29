"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { getActiveProviderLabel } from "@/lib/agentStore";

export default function AgentCta() {
  const [label, setLabel] = useState("House agent (free)");

  useEffect(() => {
    // External-system sync (localStorage), deferred so it runs as a callback.
    const t = setTimeout(() => setLabel(getActiveProviderLabel().label), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="py-8">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Bot className="h-5 w-5 text-[#e8b33d]" />
        <h2 className="text-xl sm:text-2xl tracking-tight">Bring your own agent</h2>
      </div>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl leading-6">
        Plug in your own key or run local models. Active: {label}.
      </p>
      <Link
        href="/agents"
        className="inline-block mt-4 font-ui text-sm px-4 py-2 rounded-md border border-[#3a3c37] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]"
      >
        Manage providers →
      </Link>
    </section>
  );
}
