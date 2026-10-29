import { PROBLEMS } from "@/lib/problems";
import ProblemList from "@/components/ProblemList";

export default function ArenaPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl">Arena — graded, one shot</h1>
      <p className="font-ui text-sm text-[#9a968c] mt-2 max-w-2xl">
        One defended attempt per problem. After scoring, it locks on this device. Warm up in Practice first.
      </p>
      <div className="mt-6"><ProblemList problems={PROBLEMS.filter((p) => p.mode === "arena")} /></div>
    </div>
  );
}
