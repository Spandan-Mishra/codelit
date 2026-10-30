import Link from "next/link";
import { Suspense } from "react";
import NativeConnect from "@/components/NativeConnect";

type Query = Promise<{ next?: string | string[] }>;

async function AgentConnection({ searchParams }: { searchParams: Query }) {
  const { next } = await searchParams;
  // Keep return navigation on the known solving routes, including the selected
  // scenario, and reject protocol-relative and other external destinations.
  const continueHref = typeof next === "string" && /^\/native(?:\?|\/|$)/.test(next) && !/[\\\r\n]/.test(next) ? next : "/native";
  return <><div className="mt-6"><NativeConnect continueHref={continueHref} /></div><p className="mt-5 font-ui text-sm"><Link href={continueHref} className="text-[#e8b33d] hover:underline">Back to workspace →</Link></p></>;
}

export default function AgentsPage({ searchParams }: { searchParams: Query }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <p className="font-ui text-xs uppercase tracking-[0.15em] text-[#e8b33d]">Bring your own agent</p>
      <h1 className="mt-2 text-3xl tracking-tight">Connect once. Solve here.</h1>
      <p className="mt-3 max-w-2xl font-ui text-sm leading-6 text-[#b3afa3]">Use your installed coding agent and local provider login. A small connector brings its conversation, tools, and solution changes into your Codelit workspace.</p>
      <Suspense fallback={<p className="mt-6 font-ui text-sm text-[#b3afa3]">Loading connection…</p>}><AgentConnection searchParams={searchParams} /></Suspense>
    </div>
  );
}
