import type { Problem, DebugChallenge } from "./types";

export const PROBLEMS: Problem[] = [
  {
    id: "two-sum",
    title: "Two Sum — with a twist you must defend",
    difficulty: "Easy",
    tags: ["Hash Map", "Arrays"],
    mode: "practice",
    minutes: 20,
    defendSeconds: 90,
    statement:
      "Given an array `nums` and an integer `target`, return the indices of the two numbers that add up to `target`. Exactly one solution exists and the same element cannot be used twice. Then defend it: the follow-ups mutate your code live, so pasting an answer is not enough.",
    constraints: ["2 ≤ nums.length ≤ 10^4", "-10^9 ≤ nums[i], target ≤ 10^9", "Return indices in any order"],
    examples: [
      { input: "nums = [2,7,11,15], target = 9", output: "[0,1]" },
      { input: "nums = [3,2,4], target = 6", output: "[1,2]" },
    ],
    starterPy: "def two_sum(nums, target):\n    # your code here\n    pass\n",
    starterJs: "function twoSum(nums, target) {\n  // your code here\n}\n",
    starterCpp: "#include <vector>\nusing namespace std;\n\nvector<int> two_sum(vector<int> nums, int target) {\n    // your code here\n    return {};\n}\n",
    cppReturn: "vec",
    fnName: "two_sum",
    tests: [
      { input: "two_sum([2,7,11,15], 9)", expected: "[0, 1]" },
      { input: "two_sum([3,2,4], 6)", expected: "[1, 2]" },
      { input: "two_sum([3,3], 6)", expected: "[0, 1]" },
      { input: "two_sum([-1,-2,-3], -5)", expected: "[1, 2]", hidden: true },
    ],
    hints: ["Store complement → index in a dict as you scan.", "One pass is enough."],
  },
  {
    id: "valid-parentheses",
    title: "Valid Parentheses",
    difficulty: "Easy",
    tags: ["Stack", "Strings"],
    mode: "practice",
    minutes: 15,
    defendSeconds: 90,
    statement:
      "Given a string `s` of brackets `()[]{}` return `True` if every opener is closed by the same type in the correct order.",
    constraints: ["1 ≤ s.length ≤ 10^4", "s contains only ()[]{}"],
    examples: [
      { input: 's = "()[]{}"', output: "true" },
      { input: 's = "(]"', output: "false" },
    ],
    starterPy: "def is_valid(s):\n    # your code here\n    pass\n",
    starterJs: "function isValid(s) {\n  // your code here\n}\n",
    starterCpp: "#include <string>\nusing namespace std;\n\nbool is_valid(string s) {\n    // your code here\n    return false;\n}\n",
    cppReturn: "bool",
    fnName: "is_valid",
    tests: [
      { input: 'is_valid("()[]{}")', expected: "True" },
      { input: 'is_valid("(]")', expected: "False" },
      { input: 'is_valid("([)]")', expected: "False" },
      { input: 'is_valid("{[]}")', expected: "True", hidden: true },
    ],
    hints: ["Push openers, pop on closers and compare."],
  },
  {
    id: "merge-intervals",
    title: "Merge Intervals — Graded (one shot)",
    difficulty: "Medium",
    tags: ["Sorting", "Intervals"],
    mode: "arena",
    minutes: 25,
    defendSeconds: 90,
    statement:
      "Given intervals `[start, end]`, merge all overlapping intervals and return the non-overlapping cover sorted by start. This is a graded Arena problem: you get one defended attempt. Practice problems never lock; Arena does.",
    constraints: ["1 ≤ intervals.length ≤ 10^4", "intervals[i].length == 2"],
    examples: [{ input: "[[1,3],[2,6],[8,10],[15,18]]", output: "[[1,6],[8,10],[15,18]]" }],
    starterPy: "def merge(intervals):\n    # your code here\n    pass\n",
    starterJs: "function merge(intervals) {\n  // your code here\n}\n",
    starterCpp: "#include <vector>\nusing namespace std;\n\nvector<vector<int>> merge(vector<vector<int>> intervals) {\n    // your code here\n    return {};\n}\n",
    cppReturn: "vecvec",
    fnName: "merge",
    tests: [
      { input: "merge([[1,3],[2,6],[8,10],[15,18]])", expected: "[[1, 6], [8, 10], [15, 18]]" },
      { input: "merge([[1,4],[4,5]])", expected: "[[1, 5]]" },
      { input: "merge([[1,4],[0,4]])", expected: "[[0, 4]]", hidden: true },
    ],
    hints: ["Sort by start, then sweep."],
  },
  {
    id: "group-anagrams",
    title: "Group Anagrams — Graded (one shot)",
    difficulty: "Medium",
    tags: ["Hash Map", "Strings"],
    mode: "arena",
    minutes: 25,
    defendSeconds: 90,
    statement:
      "Group the strings in `strs` that are anagrams of each other. Return groups in any order. Graded Arena: one defended attempt only.",
    constraints: ["1 ≤ strs.length ≤ 10^4", "strs[i] is lowercase English"],
    examples: [{ input: '["eat","tea","tan","ate","nat","bat"]', output: '[["bat"],["nat","tan"],["ate","eat","tea"]]' }],
    starterPy: "def group_anagrams(strs):\n    # your code here\n    pass\n",
    starterJs: "function groupAnagrams(strs) {\n  // your code here\n}\n",
    starterCpp: "#include <string>\n#include <vector>\nusing namespace std;\n\nvector<vector<string>> group_anagrams(vector<string> strs) {\n    // your code here\n    return {};\n}\n",
    cppReturn: "groups",
    fnName: "group_anagrams",
    tests: [
      { input: 'group_anagrams(["eat","tea","tan","ate","nat","bat"])', expected: "groups: bat | ate,eat,tea | nat,tan" },
      { input: 'group_anagrams([""])', expected: '[[""]]' },
      { input: 'group_anagrams(["a"])', expected: '[["a"]]', hidden: true },
    ],
    hints: ["Key = sorted word or 26-count tuple."],
  },
  {
    id: "top-k",
    title: "Top K Frequent Elements",
    difficulty: "Medium",
    tags: ["Heap", "Hash Map"],
    mode: "practice",
    minutes: 25,
    defendSeconds: 90,
    statement:
      "Given `nums` and `k`, return the `k` most frequent elements in any order. Your defense will be asked what happens when frequencies tie and when k = unique count.",
    constraints: ["1 ≤ nums.length ≤ 10^5", "k is in [1, unique count]"],
    examples: [{ input: "nums = [1,1,1,2,2,3], k = 2", output: "[1,2]" }],
    starterPy: "def top_k_frequent(nums, k):\n    # your code here\n    pass\n",
    starterJs: "function topKFrequent(nums, k) {\n  // your code here\n}\n",
    starterCpp: "#include <vector>\nusing namespace std;\n\nvector<int> top_k_frequent(vector<int> nums, int k) {\n    // your code here\n    return {};\n}\n",
    cppReturn: "vec",
    fnName: "top_k_frequent",
    tests: [
      { input: "top_k_frequent([1,1,1,2,2,3], 2)", expected: "[1, 2]" },
      { input: "top_k_frequent([1], 1)", expected: "[1]" },
      { input: "top_k_frequent([4,4,4,2,2,1], 1)", expected: "[4]", hidden: true },
    ],
    hints: ["Count, then heap or bucket sort."],
  },
  {
    id: "rotated-search",
    title: "Search in Rotated Sorted Array",
    difficulty: "Hard",
    tags: ["Binary Search"],
    mode: "practice",
    minutes: 30,
    defendSeconds: 90,
    statement:
      "Search `target` in a rotated sorted array of distinct integers in O(log n). Return its index or -1.",
    constraints: ["1 ≤ nums.length ≤ 5000", "All values distinct"],
    examples: [{ input: "nums = [4,5,6,7,0,1,2], target = 0", output: "4" }],
    starterPy: "def search(nums, target):\n    # your code here\n    pass\n",
    starterJs: "function search(nums, target) {\n  // your code here\n}\n",
    starterCpp: "#include <vector>\nusing namespace std;\n\nint search(vector<int> nums, int target) {\n    // your code here\n    return -1;\n}\n",
    cppReturn: "int",
    fnName: "search",
    tests: [
      { input: "search([4,5,6,7,0,1,2], 0)", expected: "4" },
      { input: "search([4,5,6,7,0,1,2], 3)", expected: "-1" },
      { input: "search([1], 0)", expected: "-1", hidden: true },
    ],
    hints: ["One half is always sorted."],
  },
];

export const DEBUG_CHALLENGES: DebugChallenge[] = [
  {
    id: "binary-search-offbyone",
    title: "Binary search never finds the last element",
    difficulty: "Easy",
    minutes: 6,
    maxPrompts: 4,
    description:
      "This binary search passes most tests but returns -1 for the last element. You have 6 minutes and 4 prompts to the agent. Fix the code in the editor — the agent will not write the fix for you, it only hints.",
    buggyPy: "def binary_search(arr, target):\n    lo, hi = 0, len(arr) - 1\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n",
    fixedHint: "while lo <= hi",
    tests: [
      { input: "binary_search([1,2,3,4,5], 5)", expected: "4" },
      { input: "binary_search([1,2,3,4,5], 1)", expected: "0" },
      { input: "binary_search([1,2,3,4,5], 9)", expected: "-1" },
    ],
    fnName: "binary_search",
  },
  {
    id: "two-sum-self-pair",
    title: "Two Sum pairs an element with itself",
    difficulty: "Medium",
    minutes: 8,
    maxPrompts: 4,
    description:
      "This solution returns [0,0] on some inputs. Find the ordering bug. 8 minutes, 4 prompts.",
    buggyPy: "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        seen[n] = i\n    for i, n in enumerate(nums):\n        j = seen.get(target - n)\n        if j is not None:\n            return [i, j]\n    return []\n",
    fixedHint: "check before insert / j != i",
    tests: [
      { input: "two_sum([3,2,4], 6)", expected: "[1, 2]" },
      { input: "two_sum([2,7,11,15], 9)", expected: "[0, 1]" },
    ],
    fnName: "two_sum",
  },
  {
    id: "interval-merge-sort",
    title: "Merge intervals fails on unsorted input",
    difficulty: "Medium",
    minutes: 8,
    maxPrompts: 5,
    description: "The merge logic looks right but the challenge input is shuffled. 8 minutes, 5 prompts.",
    buggyPy: "def merge(intervals):\n    out = []\n    for s, e in intervals:\n        if out and s <= out[-1][1]:\n            out[-1][1] = max(out[-1][1], e)\n        else:\n            out.append([s, e])\n    return out\n",
    fixedHint: "sort by start first",
    tests: [
      { input: "merge([[8,10],[1,3],[2,6],[15,18]])", expected: "[[1, 6], [8, 10], [15, 18]]" },
      { input: "merge([[1,4],[4,5]])", expected: "[[1, 5]]" },
    ],
    fnName: "merge",
  },
];

export function getProblem(id: string) {
  return PROBLEMS.find((p) => p.id === id);
}
export function getDebug(id: string) {
  return DEBUG_CHALLENGES.find((d) => d.id === id);
}
