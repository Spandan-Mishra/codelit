// Generative vault scenario: warehouse order fulfillment from limited stock.
// Story: warehouse fulfillment for a randomized store. All test literals are
// cross-language (ints and int lists only).

import type { Scenario, TestCase } from "../types";
import { mulberry32, pick, intBetween } from "../rand";

const STORES = ["checkout", "search", "billing", "auth", "notify", "ledger", "catalog", "sessions"] as const;

// Reference: walk orders in sequence; fulfill order i (emit 1) when its
// quantity fits in the remaining stock, otherwise skip it (emit 0).
// Skipped orders never consume stock.
export function allocateStockRef(orders: number[], stock: number): number[] {
  const out: number[] = [];
  let remaining = stock;
  for (const q of orders) {
    if (q <= remaining) {
      out.push(1);
      remaining -= q;
    } else {
      out.push(0);
    }
  }
  return out;
}

const fmtCompact = (a: number[]): string => `[${a.join(",")}]`;
const fmtSpaced = (a: number[]): string => `[${a.join(", ")}]`;

export function generateAllocateStock(seed: number): { briefs: [string, string, string]; tests: TestCase[] } {
  const rand = mulberry32(seed);
  const store = pick(rand, STORES);

  // Case 0 (sample): mixed quantities against a partial stock pile.
  const n0 = intBetween(rand, 4, 5);
  const orders0: number[] = [];
  for (let i = 0; i < n0; i++) orders0.push(intBetween(rand, 1, 5));
  const total0 = orders0.reduce((a, b) => a + b, 0);
  const stock0 = Math.max(1, total0 - intBetween(rand, 1, Math.max(1, total0 - 1)));
  // Case 1 (edge): stock exactly covers every order.
  const n1 = intBetween(rand, 3, 4);
  const orders1: number[] = [];
  for (let i = 0; i < n1; i++) orders1.push(intBetween(rand, 1, 4));
  const stock1 = orders1.reduce((a, b) => a + b, 0);
  // Case 2 (edge): every order is bigger than the whole pile.
  const n2 = intBetween(rand, 2, 4);
  const stock2 = intBetween(rand, 1, 3);
  const orders2: number[] = [];
  for (let i = 0; i < n2; i++) orders2.push(stock2 + intBetween(rand, 1, 4));
  // Case 3 (hidden): longer queue with varied quantities.
  const n3 = intBetween(rand, 6, 8);
  const orders3: number[] = [];
  for (let i = 0; i < n3; i++) orders3.push(intBetween(rand, 1, 6));
  const total3 = orders3.reduce((a, b) => a + b, 0);
  const stock3 = intBetween(rand, 1, total3);

  const cases = [
    { orders: orders0, stock: stock0 },
    { orders: orders1, stock: stock1 },
    { orders: orders2, stock: stock2 },
    { orders: orders3, stock: stock3 },
  ];
  const tests: TestCase[] = cases.map((c, i) => ({
    input: `allocate_stock(${fmtCompact(c.orders)}, ${c.stock})`,
    expected: fmtSpaced(allocateStockRef(c.orders, c.stock)),
    hidden: i === cases.length - 1,
  }));

  const briefs: [string, string, string] = [
    `The ${store} warehouse has ${stock0} units on the shelf and a queue of orders to fill. Implement allocate_stock(orders, stock): walk the order quantities in sequence and return one 1 (fulfilled) or 0 (skipped) per order. An order ships only when its full quantity fits in the remaining stock, and skipped orders consume nothing. Sample: allocate_stock(${fmtCompact(orders0)}, ${stock0}) -> ${fmtSpaced(allocateStockRef(orders0, stock0))}.`,
    `Edge queues: exact-fit stock like allocate_stock(${fmtCompact(orders1)}, ${stock1}) fulfills everything, while a pile of ${stock2} against oversized orders fulfills nothing. A skipped order never blocks a later smaller one that still fits.`,
    `Longer queues against tighter stock. Skipped orders consume nothing and never block a later order that still fits.`,
  ];
  return { briefs, tests };
}

const canon = generateAllocateStock(0);

export const allocateStockScenario: Scenario = {
  id: "vault-allocate-stock",
  title: "Allocate Stock",
  blurb: "Play warehouse keeper: walk each order in turn, fulfill it if stock remains, and never let a skipped order block a later one. With stock 6 and orders [4, 2, 5]: 4 fits (2 left), 2 fits (0 left), 5 does not — [1, 1, 0].",
  difficulty: "Medium",
  tags: ["Greedy", "Arrays"],
  minutes: 25,
  promptPar: 5,
  timePar: 20,
  stages: [
    { title: "Fill the queue", brief: canon.briefs[0], unlockHint: "Run the sample — a passing run unlocks stage 2." },
    { title: "Exact fits and dry shelves", brief: canon.briefs[1], unlockHint: "A passing run here unlocks the hidden acceptance suite." },
    { title: "Hidden acceptance", brief: canon.briefs[2], unlockHint: "Finish to run the full acceptance suite." },
  ],
  acceptance: canon.tests,
  fnName: "allocate_stock",
  variants: {
    seedKeys: ["store", "orders", "stock"],
    description: "Seeded store name, order queues, and stock piles; expected fill patterns computed by the in-order fulfillment reference.",
  },
  cppReturn: "vec",
  stubs: {
    py: "def allocate_stock(orders, stock):\n    # your code here\n    pass\n",
    js: "function allocateStock(orders, stock) {\n  // your code here\n}\n",
    cpp: "#include <vector>\nusing namespace std;\n\nvector<int> allocate_stock(vector<int> orders, int stock) {\n    // your code here\n    return {};\n}\n",
  },
  generate: generateAllocateStock,
};
