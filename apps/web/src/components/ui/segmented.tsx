import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string; disabled?: boolean; testId?: string }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-center rounded-xl bg-secondary p-1",
        size === "sm" && "rounded-lg p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-disabled={o.disabled || undefined}
          data-testid={o.testId}
          title={o.hint}
          disabled={o.disabled}
          onClick={() => { if (!o.disabled) onChange(o.value) }}
          className={cn(
            "rounded-lg px-3 font-medium text-muted-foreground transition-colors",
            size === "sm" ? "h-7 text-xs" : "h-9 text-sm",
            value === o.value && "bg-card text-foreground shadow-sm",
            o.disabled && "cursor-not-allowed opacity-40",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
