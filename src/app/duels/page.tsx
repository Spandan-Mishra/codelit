import Link from "next/link";
import { Swords, Bot, Users, Coins } from "lucide-react";

// Duels are archived behind this page until the house agent race ships.
// The previous lobby, credits, and leaderboard implementation is retained
// in git history and the duel components; nothing here starts a race.
export default function DuelsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl tracking-tight">Agent duels</h1>
        <span className="font-ui text-[11px] font-semibold text-[#e8b33d] border border-[#e8b33d]/40 rounded px-1.5 py-0.5">Coming soon</span>
      </div>
      <p className="font-ui text-sm text-[#9a968c] mt-3 max-w-2xl leading-6">
        Duels are not live yet. The ranked loop — connect, practice, defend,
        passport — is the shipped product; duels arrive on top of it.
      </p>

      <div className="grid gap-2.5 mt-8 sm:grid-cols-3 font-ui">
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-4">
          <Bot className="h-5 w-5 text-[#e8b33d]" />
          <p className="mt-2 font-semibold text-sm">Casual: race the house agent</p>
          <p className="text-[#9a968c] text-[13px] mt-1 leading-5">Same scenario, same clock. Its stage progress streams live beside yours; first fully-passing run wins.</p>
        </div>
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-4">
          <Coins className="h-5 w-5 text-[#e8b33d]" />
          <p className="mt-2 font-semibold text-sm">Credits unlock harder agents</p>
          <p className="text-[#9a968c] text-[13px] mt-1 leading-5">Wins earn credits. Spend them to face faster house agents at higher difficulty tiers.</p>
        </div>
        <div className="rounded-lg border border-[#262824] bg-[#141613] p-4">
          <Users className="h-5 w-5 text-[#e8b33d]" />
          <p className="mt-2 font-semibold text-sm">Competitive: player matchmaking</p>
          <p className="text-[#9a968c] text-[13px] mt-1 leading-5">Later, race other players and their agents — defended traces, not pasted answers, settle who actually drove.</p>
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-[#262824] bg-[#141613] p-5 font-ui">
        <p className="flex items-center gap-2 font-semibold text-sm"><Swords className="h-4 w-4 text-[#e8b33d]" /> Until then</p>
        <p className="text-[#9a968c] text-[13px] mt-1.5 leading-5 max-w-2xl">Ranked scenarios already test the same skill under time: staged requirements, a captured trace, and a timed defense of your own run.</p>
        <Link href="/scenarios" className="inline-block mt-4 font-ui font-semibold text-sm px-4 py-2 rounded-md bg-[#e8b33d] text-black hover:bg-[#f2c14e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8b33d]">Run a scenario →</Link>
      </div>
    </div>
  );
}
