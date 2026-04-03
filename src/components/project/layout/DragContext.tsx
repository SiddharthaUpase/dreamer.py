"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { DropPosition } from "./layoutReducer";

export interface DragState {
  panelId: string;
  panelType: string;
}

export interface DropTarget {
  panelId: string;
  position: DropPosition;
}

interface DragContextValue {
  drag: DragState | null;
  dropTarget: DropTarget | null;
  startDrag: (panelId: string, panelType: string) => void;
  endDrag: () => void;
  setDropTarget: (target: DropTarget | null) => void;
}

const Ctx = createContext<DragContextValue>({
  drag: null,
  dropTarget: null,
  startDrag: () => {},
  endDrag: () => {},
  setDropTarget: () => {},
});

export function DragProvider({ children }: { children: React.ReactNode }) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const startDrag = useCallback((panelId: string, panelType: string) => {
    setDrag({ panelId, panelType });
  }, []);

  const endDrag = useCallback(() => {
    setDrag(null);
    setDropTarget(null);
  }, []);

  return (
    <Ctx.Provider value={{ drag, dropTarget, startDrag, endDrag, setDropTarget }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDrag() {
  return useContext(Ctx);
}
