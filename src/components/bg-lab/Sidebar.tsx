import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourcePanel } from "./SourcePanel";
import { AddEffectSearch } from "./AddEffectSearch";
import { EffectStack } from "./EffectStack";
import { SavedPanel } from "./SavedPanel";
import { AiConfigCard } from "./AiConfigCard";
import { DraftsPanel } from "./DraftsPanel";
import { ExportBar } from "./ExportBar";

type Tab = "source" | "effects" | "drafts";
const trigger = "flex-1 data-[state=inactive]:hover:text-text-primary";

export function Sidebar({ width }: { width: number }) {
  const [tab, setTab] = useState<Tab>("effects");

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col overflow-hidden bg-canvas">
      {/* Panel header — scoped to the sidebar, no longer full-width. */}
      <div className="flex h-12 shrink-0 items-center border-b border-border-default px-4">
        <span className="font-nagel text-[18px] font-medium tracking-[-0.01em] text-text-primary">Shader Lab</span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1 flex-col">
        {/* Fixed toggle + divider underneath. */}
        <div className="shrink-0 px-3 py-3">
          <TabsList className="w-full">
            <TabsTrigger value="source" className={trigger}>
              Source
            </TabsTrigger>
            <TabsTrigger value="effects" className={trigger}>
              Effects
            </TabsTrigger>
            <TabsTrigger value="drafts" className={trigger}>
              Drafts
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="h-px shrink-0 bg-border-default" />

        <TabsContent value="source" className="mt-0 flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-3">
              <SourcePanel />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="effects" className="mt-0 flex min-h-0 flex-1 flex-col">
          {/* Add-search above the scroll region so its dropdown can overlay. */}
          <div className="shrink-0 border-b border-border-default p-3">
            <AddEffectSearch />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 p-3">
              <EffectStack />
              <div className="border-t border-border-default pt-4">
                <SavedPanel />
              </div>
              <div className="border-t border-border-default pt-4">
                <AiConfigCard />
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="drafts" className="mt-0 flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-3">
              <DraftsPanel />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <ExportBar />
    </aside>
  );
}
