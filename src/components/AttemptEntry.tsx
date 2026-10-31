"use client";

import { useEffect, useState, type ReactNode } from "react";
import AttemptPreparation from "./AttemptPreparation";

// The route template remounts this gate on entry, including links from
// attempt history. Keep the reading time separate from actual data loading.
export default function AttemptEntry({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 5000);
    return () => {
      clearTimeout(timer);
      // Next can retain a page in an Activity cache. Its effects clean up
      // when hidden, so reset the gate for the next visit as well.
      setReady(false);
    };
  }, []);

  return ready ? children : <AttemptPreparation readingTime />;
}
