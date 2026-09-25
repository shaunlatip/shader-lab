import { useState, type DragEvent } from "react";
import { toast } from "sonner";
import { useBgLab } from "./BgLabProvider";

/**
 * Drop an image/video file from the OS to set it as the source — same
 * object-URL path as the Upload buttons. Shared by the left panel and the
 * stage, so a file can land anywhere it's likely to be dragged.
 */
export function useSourceDrop() {
  const { dispatch } = useBgLab();
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const mode = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
    if (!mode) {
      toast.error("Unsupported file", { description: "Drop an image or video file." });
      return;
    }
    const url = URL.createObjectURL(file);
    dispatch({ t: "setSource", patch: { mode, imageId: url } });
  }

  const dropHandlers = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      // Required for onDrop to fire at all; only react to actual files
      // (not e.g. an internal text/slider drag) so we don't flash the
      // overlay for unrelated drag interactions.
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        setDragOver(true);
      }
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      // Only clear when the pointer actually leaves the element (not when it
      // moves between children, which also fires dragleave on the parent).
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
  };

  return { dragOver, dropHandlers };
}
