import type { Flag } from "@/lib/types";

export interface Segment {
  text: string;
  start: number;
  /** Flags covering this segment, strongest first. Empty for plain text. */
  flags: Flag[];
}

/**
 * Split `text` into non-overlapping segments annotated with the flags covering
 * each one.
 *
 * A sweep over boundaries rather than nested wrapping, because two tactics
 * routinely overlap in one sentence (a composite tactic's span often contains
 * an urgency phrase). Nesting those would produce broken markup; segmenting at
 * every boundary keeps the output flat and lets a shared region show both.
 */
export function segmentByFlags(text: string, flags: Flag[]): Segment[] {
  const spans = flags
    .filter((flag): flag is Flag & { evidence_span: [number, number] } => {
      const span = flag.evidence_span;
      if (!span) return false;
      const [start, end] = span;
      return (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end > start &&
        start < text.length
      );
    })
    .map((flag) => ({
      flag,
      start: flag.evidence_span[0],
      end: Math.min(flag.evidence_span[1], text.length),
    }));

  if (spans.length === 0) {
    return text ? [{ text, start: 0, flags: [] }] : [];
  }

  const boundaries = new Set<number>([0, text.length]);
  for (const span of spans) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }

  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments: Segment[] = [];

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const start = ordered[i]!;
    const end = ordered[i + 1]!;
    if (end <= start) continue;
    const covering = spans
      .filter((span) => span.start <= start && span.end >= end)
      .map((span) => span.flag)
      .sort((a, b) => b.weight - a.weight);
    segments.push({ text: text.slice(start, end), start, flags: covering });
  }

  return segments;
}
