import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useBgLab } from "./BgLabProvider";
import { EffectCard } from "./EffectCard";

export function EffectStack() {
  const { config, dispatch } = useBgLab();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = config.stack.findIndex((s) => s.id === active.id);
    const to = config.stack.findIndex((s) => s.id === over.id);
    if (from >= 0 && to >= 0) dispatch({ t: "reorder", from, to });
  }

  if (config.stack.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border-default px-3 py-8 text-center text-[12px] leading-relaxed text-text-secondary">
        No effects yet.
        <br />
        Search above to stack your first one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={config.stack.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {config.stack.map((effect) => (
              <EffectCard key={effect.id} effect={effect} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <p className="px-0.5 text-[11px] leading-snug text-text-secondary">
        Applied top → bottom. Drag to reorder.
      </p>
    </div>
  );
}
