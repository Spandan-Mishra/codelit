import { redirect } from "next/navigation";

// Duels are archived (see /duels). Race pages redirect to the
// coming-soon lobby instead of starting a duel.
export default function DuelPage() {
  redirect("/duels");
}
