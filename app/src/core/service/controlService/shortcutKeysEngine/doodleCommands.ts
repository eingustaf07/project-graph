export const doodleCommandEvent = "pg-doodle-command";
export const doodleCommands = [
  { id: "doodleEraser", key: "e r", action: "eraser" },
  { id: "doodleParameters", key: "", action: "parameters" },
  { id: "doodleContainerMode", key: "k k", action: "container" },
  { id: "doodleDecorationMode", key: "", action: "decoration" },
  { id: "doodleStraightLine", key: "s t", action: "line" },
  { id: "doodleRectangle", key: "s q", action: "rectangle" },
  { id: "doodleCircle", key: "c y", action: "circle" },
  { id: "doodleLegacySettings", key: "", action: "legacy" },
] as const;
export type DoodleCommand = (typeof doodleCommands)[number]["action"];
