import type { LayoutState, LayoutNode, LayoutSplit, PanelType } from "./types";

// Default layout: Chat + Terminal (left column), Browser (right)
export const DEFAULT_LAYOUT: LayoutState = {
  root: {
    type: "split",
    id: "split-root",
    direction: "horizontal",
    sizes: [40, 60],
    children: [
      {
        type: "split",
        id: "split-left",
        direction: "vertical",
        sizes: [65, 35],
        children: [
          { type: "panel", id: "chat-1", panelType: "chat" },
          { type: "panel", id: "terminal-1", panelType: "terminal" },
        ],
      },
      { type: "panel", id: "browser-1", panelType: "browser" },
    ],
  },
  nextId: 3,
};

export type DropPosition = "left" | "right" | "top" | "bottom" | "center";

export type LayoutAction =
  | { type: "ADD_PANEL"; targetId: string; panelType: PanelType; position: "right" | "below" }
  | { type: "REMOVE_PANEL"; panelId: string }
  | { type: "MOVE_PANEL"; panelId: string; targetId: string; position: DropPosition }
  | { type: "UPDATE_SIZES"; splitId: string; sizes: number[] }
  | { type: "SET_LAYOUT"; layout: LayoutState };

function generateId(panelType: PanelType, nextId: number): string {
  return `${panelType}-${nextId}`;
}

// Insert a new panel next to targetId
function addPanel(
  node: LayoutNode,
  targetId: string,
  newPanel: LayoutNode,
  position: "right" | "below"
): LayoutNode {
  if (node.type === "panel") {
    if (node.id === targetId) {
      const direction = position === "right" ? "horizontal" : "vertical";
      return {
        type: "split",
        id: `split-${Date.now()}`,
        direction,
        sizes: [50, 50],
        children: [node, newPanel],
      };
    }
    return node;
  }

  // Split node — check if target is a direct child
  const targetIndex = node.children.findIndex(
    (c) => c.type === "panel" && c.id === targetId
  );
  const desiredDirection = position === "right" ? "horizontal" : "vertical";

  if (targetIndex >= 0 && node.direction === desiredDirection) {
    // Same direction — insert as sibling
    const newChildren = [...node.children];
    newChildren.splice(targetIndex + 1, 0, newPanel);
    const evenSize = 100 / newChildren.length;
    return {
      ...node,
      children: newChildren,
      sizes: newChildren.map(() => evenSize),
    };
  }

  // Recurse into children
  return {
    ...node,
    children: node.children.map((child) =>
      addPanel(child, targetId, newPanel, position)
    ),
  };
}

// Remove a panel and clean up empty splits
function removePanel(node: LayoutNode, panelId: string): LayoutNode | null {
  if (node.type === "panel") {
    return node.id === panelId ? null : node;
  }

  const newChildren = node.children
    .map((child) => removePanel(child, panelId))
    .filter((c): c is LayoutNode => c !== null);

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];

  const evenSize = 100 / newChildren.length;
  return {
    ...node,
    children: newChildren,
    sizes: newChildren.map(() => evenSize),
  };
}

// Update sizes for a specific split
function updateSizes(node: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (node.type === "panel") return node;
  if (node.id === splitId) {
    return { ...node, sizes };
  }
  return {
    ...node,
    children: node.children.map((child) => updateSizes(child, splitId, sizes)),
  };
}

// Find a panel by ID in the tree
function findPanel(node: LayoutNode, panelId: string): LayoutNode | null {
  if (node.type === "panel") return node.id === panelId ? node : null;
  for (const child of node.children) {
    const found = findPanel(child, panelId);
    if (found) return found;
  }
  return null;
}

// Insert a panel relative to a target (for move operations)
function insertPanel(
  node: LayoutNode,
  targetId: string,
  panel: LayoutNode,
  position: DropPosition,
): LayoutNode {
  if (position === "center") {
    // Swap: replace target with panel
    if (node.type === "panel") {
      return node.id === targetId ? panel : node;
    }
    return {
      ...node,
      children: node.children.map((c) => insertPanel(c, targetId, panel, position)),
    };
  }

  const direction = (position === "left" || position === "right") ? "horizontal" : "vertical";
  const insertBefore = position === "left" || position === "top";

  if (node.type === "panel") {
    if (node.id === targetId) {
      return {
        type: "split",
        id: `split-${Date.now()}`,
        direction,
        sizes: [50, 50],
        children: insertBefore ? [panel, node] : [node, panel],
      };
    }
    return node;
  }

  // Check if target is a direct child and direction matches
  const targetIndex = node.children.findIndex((c) =>
    (c.type === "panel" && c.id === targetId) || (c.type === "split" && c.id === targetId)
  );

  if (targetIndex >= 0 && node.direction === direction) {
    const newChildren = [...node.children];
    const insertIdx = insertBefore ? targetIndex : targetIndex + 1;
    newChildren.splice(insertIdx, 0, panel);
    const evenSize = 100 / newChildren.length;
    return { ...node, children: newChildren, sizes: newChildren.map(() => evenSize) };
  }

  return {
    ...node,
    children: node.children.map((c) => insertPanel(c, targetId, panel, position)),
  };
}

// Count panels of a given type
export function countPanels(node: LayoutNode, panelType?: PanelType): number {
  if (node.type === "panel") {
    return !panelType || node.panelType === panelType ? 1 : 0;
  }
  return node.children.reduce((sum, child) => sum + countPanels(child, panelType), 0);
}

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case "ADD_PANEL": {
      const newPanel = {
        type: "panel" as const,
        id: generateId(action.panelType, state.nextId),
        panelType: action.panelType,
      };
      const newRoot = addPanel(state.root, action.targetId, newPanel, action.position);
      return { root: newRoot, nextId: state.nextId + 1 };
    }
    case "REMOVE_PANEL": {
      const total = countPanels(state.root);
      if (total <= 1) return state;
      const newRoot = removePanel(state.root, action.panelId);
      if (!newRoot) return state;
      return { ...state, root: newRoot };
    }
    case "MOVE_PANEL": {
      if (action.panelId === action.targetId) return state;
      const panel = findPanel(state.root, action.panelId);
      if (!panel) return state;
      // Remove from old position
      const afterRemove = removePanel(state.root, action.panelId);
      if (!afterRemove) return state;
      // Insert at new position
      const afterInsert = insertPanel(afterRemove, action.targetId, panel, action.position);
      return { ...state, root: afterInsert };
    }
    case "UPDATE_SIZES": {
      return { ...state, root: updateSizes(state.root, action.splitId, action.sizes) };
    }
    case "SET_LAYOUT": {
      return action.layout;
    }
    default:
      return state;
  }
}
