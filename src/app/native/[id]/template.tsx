import type { ReactNode } from "react";
import AttemptEntry from "@/components/AttemptEntry";

export default function AttemptTemplate({ children }: { children: ReactNode }) {
  return <AttemptEntry>{children}</AttemptEntry>;
}
