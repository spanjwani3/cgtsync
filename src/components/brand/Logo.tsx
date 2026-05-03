import * as React from "react";

type LogoProps = {
  size?: number;
  variant?: "light" | "dark" | "mark";
  withWordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
  accentColor?: string;
};

/**
 * CGT Sync brand logo: shield with a checkmark inside.
 * - `light` (default): for light backgrounds — navy shield, accent checkmark
 * - `dark`: for dark backgrounds — accent shield outline on transparent fill, white checkmark
 * - `mark`: just the shield+check, currentColor stroke
 */
export function Logo({
  size = 32,
  variant = "light",
  withWordmark = false,
  className,
  wordmarkClassName,
  accentColor,
}: LogoProps) {
  const accent = accentColor ?? "var(--accent, #2563eb)";
  const navy = "var(--navy, #1a2332)";

  let shieldFill: string;
  let shieldStroke: string;
  let checkStroke: string;

  if (variant === "dark") {
    shieldFill = navy;
    shieldStroke = accent;
    checkStroke = accent;
  } else if (variant === "mark") {
    shieldFill = "transparent";
    shieldStroke = "currentColor";
    checkStroke = "currentColor";
  } else {
    shieldFill = navy;
    shieldStroke = navy;
    checkStroke = accent;
  }

  const inner = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M24 4 L42 10 V24 C42 34 33 42 24 44 C15 42 6 34 6 24 V10 Z"
        fill={shieldFill}
        stroke={shieldStroke}
        strokeWidth={variant === "mark" ? 2 : 1.5}
        strokeLinejoin="round"
      />
      <path
        d="M16 24 L22 30 L33 18"
        stroke={checkStroke}
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );

  if (!withWordmark) return inner;

  return (
    <span className="inline-flex items-center gap-2.5">
      {inner}
      <span
        className={
          wordmarkClassName ??
          "text-base font-bold tracking-tight text-sidebar-text-bright"
        }
      >
        CGT Sync
      </span>
    </span>
  );
}

export default Logo;
