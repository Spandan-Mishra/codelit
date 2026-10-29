import { PROBLEMS } from "@/lib/problems";
import ProblemList from "@/components/ProblemList";

export default function PracticePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl">Practice</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl">Unlimited attempts. Solve, run, then survive 3 timed follow-ups. Nothing here locks.</p>
      <div className="mt-6"><ProblemList problems={PROBLEMS.filter((p) => p.mode === "practice")} /></div>
    </div>
  );
}
