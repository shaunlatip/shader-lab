import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCopy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildPrompt, validateConfig } from "@/lib/bg-lab/schema";
import { useBgLab } from "./BgLabProvider";
import { useLibrary } from "./LibraryProvider";
import { CollapsibleSection, labButton } from "./panel";

export function AiConfigCard() {
  const { config } = useBgLab();
  const { saveStackFrom, applyStack } = useLibrary();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [name, setName] = useState("");

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildPrompt(config));
      toast.success("Prompt copied", {
        description: "Paste into any LLM, describe your change, then paste its JSON back here.",
      });
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  function apply() {
    try {
      const cfg = validateConfig(text);
      const label = name.trim() || "AI set";
      saveStackFrom(label, cfg.stack); // saves into the Saved list
      applyStack(cfg.stack); // and loads it live
      setOpen(false);
      setText("");
      setName("");
      toast.success("Saved to your sets", { description: label });
    } catch (e) {
      toast.error("Couldn't apply config", { description: e instanceof Error ? e.message : "Invalid input" });
    }
  }

  return (
    <CollapsibleSection title="Customize with AI" defaultOpen={false}>
      <div className="flex flex-col gap-2.5">
        <p className="text-[11px] leading-snug text-text-secondary">
          No agent needed — copy a prompt, tell any LLM what you want, paste its JSON back to save it as a new set.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className={cn("flex-1", labButton)} onClick={copyPrompt}>
            <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" /> Copy prompt
          </Button>
          <button type="button" onClick={() => setOpen(true)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1", labButton)}>
            Paste & save
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="lab-chrome font-lab border-border-default bg-canvas text-text-primary">
          <DialogHeader>
            <DialogTitle>Save AI config as a set</DialogTitle>
            <DialogDescription>
              Paste the JSON the LLM returned. It’s validated and clamped, then saved to your sets and applied.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Set name (e.g. Neon riso)"
            className="text-sm"
          />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{ "version": 1, "output": …, "source": …, "stack": [ … ] }'
            className="h-48 border-border-default bg-canvas font-mono text-xs text-text-primary placeholder:text-text-secondary"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={apply}
              disabled={!text.trim()}
              className="bg-text-primary text-canvas hover:bg-text-primary/90"
            >
              Save set
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CollapsibleSection>
  );
}
