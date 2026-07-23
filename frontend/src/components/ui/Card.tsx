import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={`rounded-3xl border border-line bg-surface p-5 sm:p-6 ${className}`}>
      {children}
    </Tag>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-bold tracking-wide text-ink-soft uppercase">{children}</h2>
  );
}
