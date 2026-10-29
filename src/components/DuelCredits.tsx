"use client";
import { useEffect, useState } from "react";
import { Coins } from "lucide-react";

export default function DuelCredits() {
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/duel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "credits" }),
        });
        const data = await res.json();
        if (alive && res.ok && typeof data.credits === "number") setCredits(data.credits);
      } catch {
        // Balance stays hidden rather than crashing the page.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (credits === null) return null;
  return (
    <span className="font-ui text-[13px] text-[#9a968c] inline-flex items-center gap-1.5 whitespace-nowrap">
      <Coins className="h-4 w-4 text-[#e8b33d]" /> {credits} credit{credits === 1 ? "" : "s"}
    </span>
  );
}
