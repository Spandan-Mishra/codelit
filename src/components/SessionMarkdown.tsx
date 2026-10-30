import { Fragment, type ReactNode } from "react";

// Deliberately renders text through React, never HTML. Only safe link schemes
// become anchors; code (including unfinished streamed fences) keeps whitespace.
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const token = /(`+)([\s\S]*?)\1|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~]+)~~/g;
  let start = 0;
  for (const match of text.matchAll(token)) {
    if (match.index! > start) parts.push(text.slice(start, match.index));
    const key = match.index;
    if (match[1]) {
      parts.push(<code key={key} className="rounded bg-white/7 px-1 py-0.5 font-code text-[0.9em] text-[#efcf88]">{match[2]}</code>);
    } else if (match[3]) {
      const href = match[4];
      if (/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href)) {
        parts.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-[#e8b33d] underline underline-offset-4 break-all">{match[3]}</a>);
      } else parts.push(<Fragment key={key}>{match[3]} ({href})</Fragment>);
    } else if (match[5] || match[6]) parts.push(<strong key={key} className="font-semibold text-[#ece9e2]">{inline(match[5] || match[6])}</strong>);
    else if (match[7] || match[8]) parts.push(<em key={key}>{inline(match[7] || match[8])}</em>);
    else parts.push(<del key={key}>{inline(match[9])}</del>);
    start = match.index! + match[0].length;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

function isBlock(line: string) {
  return /^\s*(`{3,}|~{3,})|^#{1,6}\s|^\s*(?:[-+*]|\d+[.)])\s|^\s*>|^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line);
}

export default function SessionMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const key = i;
    const fence = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const language = fence[2].trim();
      const content: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) content.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<div key={key} className="my-3 min-w-0 overflow-hidden rounded-lg border border-[#30322c] bg-[#0b0d0a]">{language && <div className="border-b border-[#262824] px-3 py-1.5 font-code text-[10px] text-[#999d90]">{language}</div>}<pre className="overflow-x-auto p-3 font-code text-xs leading-6 text-[#dedfd6] [tab-size:2]"><code>{content.join("\n")}</code></pre></div>);
      continue;
    }
    const heading = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push(<div role="heading" aria-level={heading[1].length} key={key} className={`mt-4 mb-2 font-semibold text-[#ece9e2] ${heading[1].length <= 2 ? "text-base" : "text-sm"}`}>{inline(heading[2])}</div>);
      i++; continue;
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(lines[i])) {
      blocks.push(<hr key={key} className="my-4 border-[#30322c]" />); i++; continue;
    }
    if (/^\s*>/.test(lines[i])) {
      const content: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) content.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={key} className="my-3 border-l-2 border-[#e8b33d]/50 pl-3 text-[#b6b9ad]"><SessionMarkdown text={content.join("\n")} /></blockquote>);
      continue;
    }
    const list = lines[i].match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]);
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        const content = [item[3]];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !isBlock(lines[i])) content.push(lines[i++].trim());
        items.push(<li key={items.length} className="pl-1 whitespace-pre-wrap">{inline(content.join("\n"))}</li>);
      }
      blocks.push(ordered ? <ol key={key} start={Number(list[2])} className="my-3 list-decimal space-y-1 pl-5">{items}</ol> : <ul key={key} className="my-3 list-disc space-y-1 pl-5">{items}</ul>);
      continue;
    }
    // Tables are common in agent explanations. Cells still pass through the
    // same safe inline renderer; HTML and arbitrary URLs stay inert text.
    if (lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const header = cells(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(<div key={key} className="my-3 overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><thead><tr>{header.map((cell, n) => <th key={n} className="border border-[#30322c] px-3 py-2 font-semibold">{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{row.map((cell, j) => <td key={j} className="border border-[#30322c] px-3 py-2">{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    // Indented code (4 spaces or a tab) is how agents often paste code without
    // fences. Like fenced blocks, it renders through React as inert text.
    // It cannot interrupt a paragraph, so this check stays after paragraph
    // continuation above and only triggers at a block boundary.
    if (/^(?: {4}|\t)/.test(lines[i])) {
      const content: string[] = [];
      while (i < lines.length && /^(?: {4}|\t)/.test(lines[i])) content.push(lines[i++].replace(/^(?: {4}|\t)/, ""));
      blocks.push(<div key={key} className="my-3 min-w-0 overflow-hidden rounded-lg border border-[#30322c] bg-[#0b0d0a]"><pre className="overflow-x-auto p-3 font-code text-xs leading-6 text-[#dedfd6] [tab-size:4]"><code>{content.join("\n")}</code></pre></div>);
      continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !isBlock(lines[i]) && !(i + 1 < lines.length && lines[i].includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]))) paragraph.push(lines[i++]);
    blocks.push(<p key={key} className="my-2 whitespace-pre-wrap">{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="min-w-0 break-words text-sm leading-7 text-[#c5c7bc] [&>:first-child]:mt-0 [&>:last-child]:mb-0">{blocks}</div>;
}
