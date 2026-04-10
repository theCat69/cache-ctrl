import type { CacheEntry } from "../types/cache.js";
import { getFileStem } from "../utils/fileStem.js";

export function scoreEntry(entry: CacheEntry, keywords: string[]): number {
  const stem = getFileStem(entry.file).toLowerCase();
  const subject = entry.subject.toLowerCase();
  const description = (entry.description ?? "").toLowerCase();

  let total = 0;
  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();
    let score = 0;

    // Exact file stem match
    if (stem === kw) {
      score = Math.max(score, 100);
    } else if (stem.includes(kw)) {
      // Substring file stem match
      score = Math.max(score, 80);
    }

    // Exact word match on subject/topic
    if (isExactWordMatch(subject, kw)) {
      score = Math.max(score, 70);
    } else if (subject.includes(kw)) {
      // Substring match on subject/topic
      score = Math.max(score, 50);
    }

    // Keyword match on description
    if (description.includes(kw)) {
      score = Math.max(score, 30);
    }

    total += score;
  }
  return total;
}

export function rankResults(entries: CacheEntry[], keywords: string[]): CacheEntry[] {
  const scored = entries.map((entry) => ({
    entry,
    score: scoreEntry(entry, keywords),
  }));

  // Filter out zero-score entries
  const matched = scored.filter((s) => s.score > 0);

  // Sort by score descending; preserve order for ties
  matched.sort((a, b) => b.score - a.score);

  return matched.map((s) => ({ ...s.entry, score: s.score }));
}

export function isExactWordMatch(text: string, keyword: string): boolean {
  // Match whole words — split on non-alphanumeric chars
  const words = text.split(/[\s\-_./]+/);
  return words.some((word) => word === keyword);
}
