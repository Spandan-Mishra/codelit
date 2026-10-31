import Link from "next/link";
import { ArrowRight, FileCode2, LoaderCircle, MessageSquare } from "lucide-react";

export default function AttemptPreparation({ fullScreen = false, title, attemptHref, readingTime = false }: {
  fullScreen?: boolean;
  title?: string;
  attemptHref?: string;
  readingTime?: boolean;
}) {
  return <div className={fullScreen ? "fixed inset-0 z-50 grid place-items-center bg-[#0c0d0b]/95 px-4 backdrop-blur-sm" : "mx-auto grid min-h-[65vh] max-w-3xl place-items-center px-4 py-12"}>
    <div className="attempt-enter w-full max-w-lg rounded-2xl border border-[#e8b33d]/25 bg-[#141613] p-7 text-center font-ui sm:p-10">
      <div role="status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="mx-auto h-8 w-8 animate-spin text-[#e8b33d]" />
        <h2 className="mt-5 text-xl font-semibold text-[#ece9e2]">Preparing your attempt</h2>
        {title && <p className="mt-2 text-sm text-[#e8b33d]">{title}</p>}
        <p className="mt-3 text-sm leading-6 text-[#b3afa3]">Opening your question, agent conversation, and solution file in one workspace.</p>
        <ol className="mt-5 space-y-3 rounded-lg border border-[#30322c] bg-black/20 p-4 text-left text-xs leading-6 text-[#c9c5ba]" aria-label="Attempt instructions">
          <li><span className="mr-2 font-semibold text-[#e8b33d]">1.</span>Read the current stage brief and examples.</li>
          <li><span className="mr-2 font-semibold text-[#e8b33d]">2.</span>Prompt your agent in chat. It writes the solution file.</li>
          <li><span className="mr-2 font-semibold text-[#e8b33d]">3.</span>Review the code, run checks, and unlock the next stage.</li>
        </ol>
        {readingTime && <p className="mt-3 text-xs text-[#e8b33d]">Take five seconds to review these steps. Your workspace opens automatically.</p>}
        <div className="mt-6 flex justify-center gap-5 text-xs text-[#9a968c]">
          <span className="inline-flex items-center gap-2"><MessageSquare aria-hidden="true" size={14} />Agent chat</span>
          <span className="inline-flex items-center gap-2"><FileCode2 aria-hidden="true" size={14} />Solution file</span>
        </div>
        <p className="mt-5 text-xs leading-5 text-[#9a968c]">{fullScreen ? "You’ll write your first prompt on the next screen." : "Your saved progress stays with this attempt."}</p>
      </div>
      {attemptHref && <Link href={attemptHref} className="mt-5 inline-flex items-center gap-2 text-xs text-[#e8b33d] hover:underline">Open attempt<ArrowRight aria-hidden="true" size={12} /></Link>}
    </div>
  </div>;
}
