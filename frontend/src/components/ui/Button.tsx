import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white border-brand hover:bg-brand-dark active:bg-brand-dark",
  secondary: "bg-surface text-ink border-line-strong hover:bg-brand-tint",
  quiet: "bg-transparent text-ink-soft border-transparent hover:bg-black/5",
  danger: "bg-scam-tint text-scam border-scam/25 hover:bg-scam/15",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  block = false,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`focus-ring inline-flex items-center justify-center gap-2 rounded-2xl border px-5 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${block ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
