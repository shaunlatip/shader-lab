import * as React from "react";
import { cn } from "@/lib/utils";

function Input({
  className,
  type = "text",
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-frame border border-border-default bg-canvas-elevated px-3 py-1 text-base text-text-primary placeholder:text-text-secondary outline-none transition-colors",
        "focus-visible:border-text-primary focus-visible:ring-2 focus-visible:ring-text-primary/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "selection:bg-text-primary selection:text-canvas",
        className
      )}
      {...props}
    />
  );
}

export { Input };
