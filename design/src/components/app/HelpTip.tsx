import { CircleHelp } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import type { ReactNode } from "react";

export function HelpTip({ content, label }: { content: ReactNode; label?: string }) {
  return (
    <Hint content={content}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        aria-label={label ?? "help"}
      >
        <CircleHelp className="size-3.5" />
      </button>
    </Hint>
  );
}
