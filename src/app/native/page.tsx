import NativeStart from "@/components/NativeStart";
import { ALL_SCENARIOS } from "@/lib/scenarios";

export default function NativePage() {
  const scenarios = ALL_SCENARIOS.map((s) => ({ id: s.id, title: s.title }));
  return <NativeStart scenarios={scenarios} />;
}
