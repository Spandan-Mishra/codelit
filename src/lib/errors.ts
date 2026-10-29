type Rule = { re: RegExp; hint: (raw: string, m: RegExpMatchArray) => string };

const RULES: Rule[] = [
  // --- timeouts / resource limits (all languages) ---
  { re: /ETIMEDOUT|timed out|SIGTERM/i, hint: () => "Your code timed out — check for an infinite loop or an algorithm that's too slow." },
  { re: /maxBuffer|stdout maxBuffer exceeded/i, hint: () => "Your program printed too much output — check for a print inside an infinite loop." },
  { re: /MemoryError|out of memory/i, hint: () => "Your program ran out of memory — check for unbounded growth in a loop or recursion." },
  { re: /RecursionError|maximum recursion|Maximum call stack/i, hint: () => "Infinite recursion — the function kept calling itself without reaching a base case." },

  // --- Python: unclosed brackets ---
  { re: /was never closed|unexpected EOF while parsing/i, hint: () => "A bracket opened on some line was never closed — check for a missing ')', ']', or '}'." },

  // --- Python: indentation ---
  { re: /IndentationError|expected an indented block|unexpected indent|unindent/i, hint: () => "Indentation problem — after a line ending in ':' the block must be indented consistently (4 spaces, no mixed tabs)." },

  // --- Python: names ---
  { re: /NameError:\s*name '([^']+)' is not defined/, hint: (_r, m) => `The name '${m[1]}' isn't defined — check spelling and that it's assigned before this line.` },
  { re: /NameError|is not defined/i, hint: () => "You used a variable or function that isn't defined — check spelling and that it's declared before use." },
  { re: /UnboundLocalError/i, hint: () => "You read a variable before assigning it in this function — check the assignment order." },

  // --- Python: types ---
  { re: /takes \d+ positional argument|missing \d+ required positional argument/i, hint: () => "Wrong number of function arguments — check the call matches the definition." },
  { re: /'NoneType' object is not/i, hint: () => "Your code used None where a value was expected — a function may have returned nothing (missing return?)." },
  { re: /object is not callable/i, hint: () => "You called something that isn't a function — maybe a variable overwrote the function name." },
  { re: /not subscriptable/i, hint: () => "You used [...] on a value that isn't a list, dict, or string — check for None or a wrong type." },
  { re: /not iterable|argument of type .* is not iterable/i, hint: () => "You looped over or unpacked something that isn't a collection — check for None or a single number." },
  { re: /unsupported operand|can only concatenate|must be .*?, not /i, hint: () => "You mixed incompatible types (e.g. str with int) — convert with int()/str() or check the values." },
  { re: /AttributeError/i, hint: () => "That object has no such attribute or method — check spelling and that the value is the type you expect." },
  { re: /TypeError/i, hint: () => "A value had the wrong type for that operation — check for None, wrong argument count, or mixing str/int/list." },

  // --- Python: containers / values ---
  { re: /IndexError|list index out of range/i, hint: () => "Index out of range — the list is shorter than the index you asked for; check loop bounds." },
  { re: /KeyError:\s*(.+)/, hint: (_r, m) => `The key ${m[1].trim()} isn't in the dictionary — check it exists first (use 'in' or .get()).` },
  { re: /KeyError/i, hint: () => "Dictionary key not found — check the key exists first (use 'in' or .get())." },
  { re: /ZeroDivisionError|division by zero/i, hint: () => "Division by zero — guard the denominator before dividing." },
  { re: /invalid literal for int/i, hint: () => "int() got text that isn't a number — check the string before converting." },
  { re: /ValueError/i, hint: () => "A value had the right type but a bad value — check int() inputs and unpacking counts." },
  { re: /ModuleNotFoundError|No module named|ImportError/i, hint: () => "Import failed — that module isn't available in the runner; stick to plain standard code." },

  // --- Python: syntax (generic, after specific cases) ---
  { re: /SyntaxError|invalid syntax|illegal target|can't assign to/i, hint: () => "Python couldn't parse your code — check for a typo, a missing colon, or an unbalanced bracket near the reported line." },

  // --- g++ ---
  { re: /was not declared in this scope/i, hint: () => "C++: that name isn't declared — check spelling, a missing #include, or a missing std:: prefix." },
  { re: /expected ';'/i, hint: () => "C++: missing semicolon — check the end of the line above the reported one." },
  { re: /no matching function|no match for/i, hint: () => "C++: no function matches that call — check argument count and types." },
  { re: /undefined reference/i, hint: () => "C++: undefined reference — you called a function that isn't defined anywhere." },
  { re: /expected .* before/i, hint: () => "C++: syntax problem near the reported spot — check brackets, semicolons, and type names." },
  { re: /error:/i, hint: () => "C++ compile error — read the first reported line: usually a typo, a missing ';', or an undeclared name." },

  // --- JavaScript ---
  { re: /is not a function/i, hint: () => "You called something that isn't a function — check the name and what it holds." },
  { re: /Cannot read propert|Cannot set propert|of undefined|of null/i, hint: () => "Your code touched a property of undefined/null — check the value exists before using it." },
  { re: /Unexpected end of input/i, hint: () => "A bracket or brace was never closed — check for a missing ')', ']', or '}'." },
  { re: /Unexpected token|Unexpected identifier|missing \) after/i, hint: () => "JavaScript couldn't parse your code — check for a typo or an unbalanced bracket near the reported spot." },
  { re: /ReferenceError/i, hint: () => "You used a variable that isn't declared — check spelling and that it's declared before use." },
];

export function friendlyHint(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  for (const rule of RULES) {
    const m = clean.match(rule.re);
    if (m) return rule.hint(clean, m);
  }
  return "Your code hit a run error — read the detail and check the reported line.";
}

export function friendlyRunError(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  const combined = `${friendlyHint(clean)} (detail: ${clean})`;
  return combined.length > 300 ? combined.slice(0, 297) + "..." : combined;
}
