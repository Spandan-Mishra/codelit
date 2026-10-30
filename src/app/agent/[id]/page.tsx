import Link from "next/link";
import { redirect } from "next/navigation";
import { getScenario } from "@/lib/scenarios";

export const instant = false;

// Single-flow UX: scenarios solve directly at /native?scenario=<id>, so this
// route intentionally stays a redirect and must not grow a second solve page.
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
  redirect(`/native?scenario=${encodeURIComponent(s.id)}`);
}
