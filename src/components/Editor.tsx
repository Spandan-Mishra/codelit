"use client";
import dynamic from "next/dynamic";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export default function Editor({
  value,
  onChange,
  language,
  height = 420,
  onPaste,
}: {
  value: string;
  onChange: (v: string) => void;
  language: "python" | "javascript";
  height?: number;
  onPaste?: (chars: number) => void;
}) {
  return (
    <div className="rounded-lg overflow-hidden border border-[#2c2e2a]" onPaste={(e) => onPaste?.(e.clipboardData.getData("text").length)}>
      <Monaco
        height={height}
        language={language}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        theme="vs-dark"
        options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true }}
      />
    </div>
  );
}
