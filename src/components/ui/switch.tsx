import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // This project doesn't define shadcn's bg-primary/bg-input tokens, so
        // the switch maps to the design system's neutral shades (matches how
        // tabs.tsx diverges): foreground/white = on, border-strong = off. The
        // thumb flips light↔dark to stay high-contrast on either track — the
        // same relationship shadcn uses in dark mode, sans any brand accent.
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-text-primary data-[state=unchecked]:bg-border-strong",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full ring-0 transition-transform duration-150 ease-out group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 data-[state=checked]:bg-canvas data-[state=unchecked]:bg-text-primary"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
