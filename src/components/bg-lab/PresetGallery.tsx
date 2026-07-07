"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LayoutGrid, Plus, Shuffle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  CURATED_PRESETS,
  PRESET_CATEGORY_ORDER,
  PRESETS,
  type Preset,
} from "@/lib/bg-lab/presets";
import type { SavedEffect } from "@/lib/bg-lab/library";
import { useLibrary } from "./LibraryProvider";
import { CollapsibleSection, labButton } from "./panel";

const thumb = (slug: string) => `/presets/${slug}.webp`;

function PresetCard({ preset, onApply }: { preset: Preset; onApply: () => void }) {
  return (
    <button
      type="button"
      onClick={onApply}
      title={preset.name}
      className="group flex flex-col gap-1 text-left"
    >
      <span className="overflow-hidden rounded-card border border-border-default transition-[border-color,transform] duration-150 ease-out group-hover:border-border-strong motion-safe:group-active:scale-[0.97]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb(preset.slug)}
          alt={preset.name}
          loading="lazy"
          className="aspect-[3/2] w-full object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.04]"
        />
      </span>
      <span className="truncate px-0.5 text-[11px] leading-tight text-text-secondary transition-colors group-hover:text-text-primary">
        {preset.name}
      </span>
    </button>
  );
}

function UserChip({ set, onApply, onRemove }: { set: SavedEffect; onApply: () => void; onRemove: () => void }) {
  return (
    <div className="group/chip relative">
      <button
        type="button"
        onClick={onApply}
        title={`${set.name} — ${set.stack.length} effect${set.stack.length === 1 ? "" : "s"}`}
        className="max-w-full truncate rounded-chip border border-border-default bg-canvas py-1 pl-3 pr-6 text-[12px] text-text-secondary transition-[transform,color,border-color,background-color] duration-150 ease-out hover:border-border-strong hover:bg-surface-hover hover:text-text-primary motion-safe:active:scale-[0.96]"
      >
        {set.name}
      </button>
      <button
        type="button"
        aria-label={`Delete ${set.name}`}
        onClick={onRemove}
        className="absolute right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full text-text-secondary opacity-0 transition-opacity hover:text-text-primary group-hover/chip:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * The preset surface: curated thumbnail cards by category (rendered from a
 * fixed reference image, Figma-style — content chosen to show each effect,
 * not the user's current source), a shuffle, an all-presets search, and the
 * user's own saved sets.
 */
export function PresetGallery() {
  const { saved, saveStack, applyStack, removeSaved } = useLibrary();
  const [name, setName] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const byCategory = useMemo(
    () =>
      PRESET_CATEGORY_ORDER.map((cat) => ({
        cat,
        presets: CURATED_PRESETS.filter((p) => p.category === cat),
      })).filter((g) => g.presets.length > 0),
    [],
  );

  function apply(preset: Preset) {
    // Scene presets carry their own generative source (clouds/caustics/sky);
    // everything else keeps the user's current source.
    applyStack(preset.build(), preset.source);
    toast.success(preset.name);
  }
  function shuffle() {
    const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    apply(p);
  }
  function save() {
    saveStack(name);
    toast.success("Effect set saved", { description: name.trim() || "Untitled set" });
    setName("");
  }

  return (
    <CollapsibleSection
      title="Presets"
      defaultOpen
      action={
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={shuffle}
            aria-label="Apply a random preset"
            className="grid h-6 w-6 place-items-center rounded-control text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Browse all presets"
            className="grid h-6 w-6 place-items-center rounded-control text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {byCategory.map(({ cat, presets }) => (
          <div key={cat} className="flex flex-col gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">{cat}</span>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((p) => (
                <PresetCard key={p.slug} preset={p} onApply={() => apply(p)} />
              ))}
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className={cn(labButton, "h-8 rounded-control text-[12px]")}
        >
          All presets ({PRESETS.length})
        </button>

        {/* Save the live stack + user's sets */}
        <div className="flex flex-col gap-2 border-t border-border-default pt-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="flex gap-1.5"
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Save current effects…"
              className="h-8 text-xs"
            />
            <button
              type="submit"
              aria-label="Save current effects"
              className={cn(labButton, "grid h-8 w-8 shrink-0 place-items-center rounded-control")}
            >
              <Plus className="h-4 w-4" />
            </button>
          </form>
          {saved.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {saved.map((s) => (
                <UserChip key={s.id} set={s} onApply={() => applyStack(s.stack)} onRemove={() => removeSaved(s.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="lab-chrome font-lab overflow-hidden border-border-default bg-canvas p-0 text-text-primary sm:max-w-[420px]">
          <DialogTitle className="sr-only">All presets</DialogTitle>
          <Command className="bg-transparent">
            <CommandInput placeholder="Search presets…" />
            <CommandList className="max-h-[420px]">
              <CommandEmpty>No presets found.</CommandEmpty>
              {PRESET_CATEGORY_ORDER.map((cat) => {
                const items = PRESETS.filter((p) => p.category === cat);
                if (!items.length) return null;
                return (
                  <CommandGroup key={cat} heading={cat}>
                    {items.map((p) => (
                      <CommandItem
                        key={p.slug}
                        value={`${p.name} ${cat}`}
                        onSelect={() => {
                          apply(p);
                          setSearchOpen(false);
                        }}
                        className="gap-2.5"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumb(p.slug)}
                          alt=""
                          loading="lazy"
                          className="h-8 w-12 shrink-0 rounded-[4px] border border-border-default object-cover"
                        />
                        <span className="truncate text-[13px]">{p.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </CollapsibleSection>
  );
}
