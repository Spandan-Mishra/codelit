import Link from "next/link";
import AgentClient from "@/components/AgentClient";
import { getScenario } from "@/lib/scenarios";

export const instant = false;

// Thin server wrapper: only display metadata crosses to the client.
// Stage briefs and tests always come from /api/agent-run at runtime.
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getScenario(id);
  if (!s) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 font-ui">
        Scenario not found. <Link className="text-[#e8b33d]" href="/scenarios">Back to scenarios</Link>
      </div>
    );
  }
  return (
    <AgentClient
      id={s.id}
      title={s.title}
      difficulty={s.difficulty}
      tags={s.tags}
      minutes={s.minutes}
      promptPar={s.promptPar}
      timePar={s.timePar}
      fnName={s.fnName}
      stubs={s.stubs}
      cppReturn={s.cppReturn}
    />
  );
}
