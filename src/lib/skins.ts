export type SkinId =
  | "ember"
  | "blackout"
  | "phosphor"
  | "blueprint"
  | "abyss"
  | "specter"
  | "notes"
  | "daybreak"
  | "trace"
  | "eyes";

export type Density = "comfortable" | "compact";
export type Contrast = "standard" | "high";
export type CanvasStyle = "clean" | "dotted" | "grid";

export type Skin = {
  id: SkinId;
  index: string;
  name: string;
  line: string;
  swatch: { bg: string; panel: string; node: string; ink: string };
};

export const SKINS: Skin[] = [
  {
    id: "ember",
    index: "01",
    name: "EMBER",
    line: "Charcoal, burnt orange, warm gray.",
    swatch: { bg: "#141210", panel: "#1e1a17", node: "#e85d2a", ink: "#f4ece3" },
  },
  {
    id: "blackout",
    index: "02",
    name: "BLACKOUT",
    line: "Near-black, graphite, silver. No decorative color.",
    swatch: { bg: "#050505", panel: "#161616", node: "#c8c8c8", ink: "#f2f2f2" },
  },
  {
    id: "phosphor",
    index: "03",
    name: "PHOSPHOR",
    line: "Dark forest and soft green. No glow.",
    swatch: { bg: "#0c1410", panel: "#14201a", node: "#7dba6a", ink: "#eef6ee" },
  },
  {
    id: "blueprint",
    index: "04",
    name: "BLUEPRINT",
    line: "Midnight navy and steel blue.",
    swatch: { bg: "#0c1424", panel: "#152238", node: "#7eadd4", ink: "#f5f8fc" },
  },
  {
    id: "abyss",
    index: "05",
    name: "ABYSS",
    line: "Deep blue-green, muted cyan, fog white.",
    swatch: { bg: "#071416", panel: "#102428", node: "#6aabab", ink: "#f2f7f7" },
  },
  {
    id: "specter",
    index: "06",
    name: "SPECTER",
    line: "Smoky violet and lavender. No clutter.",
    swatch: { bg: "#121014", panel: "#1c1822", node: "#b7a4d4", ink: "#f6f3fa" },
  },
  {
    id: "notes",
    index: "07",
    name: "FIELD NOTES",
    line: "Ivory, parchment, sepia.",
    swatch: { bg: "#f3ecdf", panel: "#fffaf1", node: "#8c4a2f", ink: "#1d1610" },
  },
  {
    id: "daybreak",
    index: "08",
    name: "DAYBREAK",
    line: "Soft white, cool slate, muted blue.",
    swatch: { bg: "#f6f7f9", panel: "#ffffff", node: "#4d6f8c", ink: "#161b22" },
  },
  {
    id: "trace",
    index: "10",
    name: "TRACE",
    line: "Black glass, signal cyan, a mark of our own.",
    swatch: { bg: "#06080a", panel: "#0c1216", node: "#2ee6ff", ink: "#f3feff" },
  },
  {
    id: "eyes",
    index: "09",
    name: "OH, GOD. MY EYES!",
    line: "Designed by someone who has heard of color theory and chosen violence.",
    swatch: { bg: "#ffff00", panel: "#ff00a8", node: "#00ff00", ink: "#0000ff" },
  },
];

const KEY = "reaper-skin-v2";

export type Look = {
  skin: SkinId;
  density: Density;
  contrast: Contrast;
  canvas: CanvasStyle;
};

export const DEFAULT_LOOK: Look = {
  skin: "trace",
  density: "comfortable",
  contrast: "standard",
  canvas: "dotted",
};

export function loadLook(): Look {
  if (typeof window === "undefined") return DEFAULT_LOOK;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LOOK;
    return { ...DEFAULT_LOOK, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_LOOK;
  }
}

export function saveLook(look: Look) {
  window.localStorage.setItem(KEY, JSON.stringify(look));
}

export function applyLook(look: Look) {
  const root = document.documentElement;
  root.dataset.skin = look.skin;
  root.dataset.density = look.density;
  root.dataset.contrast = look.contrast;
  root.dataset.canvas = look.canvas;
}
