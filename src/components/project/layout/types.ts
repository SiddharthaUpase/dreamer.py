export type PanelType = "chat" | "terminal" | "browser";

export interface LayoutLeaf {
  type: "panel";
  id: string;
  panelType: PanelType;
}

export interface LayoutSplit {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

export interface LayoutState {
  root: LayoutNode;
  nextId: number;
}
