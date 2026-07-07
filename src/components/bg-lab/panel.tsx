import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared lab chrome. One button language + one section-header treatment so the
 * panels read cohesively (modeled on Figma / Paper's inspector panels).
 */

// White surface, subtle gray outline — the segmented-control / Paper "Copy link"
// language. Use on secondary/utility buttons via className.
export const labButton =
  "border border-border-default bg-canvas text-text-primary shadow-xs transition-[transform,background-color,border-color] duration-150 hover:border-border-strong hover:bg-surface-hover active:scale-[0.98]";

/**
 * Section header: a light Title-Case label (not a heavy uppercase eyebrow) with
 * an optional action aligned right, the Figma/Paper inspector pattern.
 */
export function SectionHeader({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-6 items-center justify-between", className)}>
      <h2 className="text-[13px] font-medium leading-none text-text-primary">{children}</h2>
      {action}
    </div>
  );
}

/**
 * Collapsible section — Figma/Paper accordion. The label + chevron toggle the
 * body (height-animated via the 0fr↔1fr grid trick); `action` stays clickable
 * without toggling.
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  action,
  children,
  className,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("flex flex-col", className)}>
      <div className="flex h-6 items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group -ml-1 flex flex-1 items-center gap-1 rounded py-0.5 pl-1 text-left"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-text-secondary transition-transform duration-200 ease-out",
              open && "rotate-90",
            )}
          />
          <span className="text-[13px] font-medium leading-none text-text-primary">{title}</span>
        </button>
        {action}
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="pt-2.5">{children}</div>
        </div>
      </div>
    </section>
  );
}
