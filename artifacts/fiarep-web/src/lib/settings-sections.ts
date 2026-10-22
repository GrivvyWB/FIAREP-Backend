import { BUTTON_GUIDE } from "./button-guide";

// What the website's Settings page shows, each with its own switch in Platform Control
// → Module Management → Settings page. On unless switched off for the client.
export const SETTINGS_SECTIONS: { key: string; name: string }[] = [
  { key: "settings.profile", name: "Profile Details (role and status)" },
  { key: "settings.language", name: "Language" },
  { key: "settings.defaultRates", name: "Shared Default Rates" },
  { key: "settings.access", name: "Access & Security (assigned developments)" },
  { key: "settings.buttonGuide", name: "What the buttons do (the whole guide)" },
  ...BUTTON_GUIDE.map((g) => ({ key: `settings.guide.${g.module}`, name: `What the buttons do → ${g.page}` })),
];
export const settingShown = (modules: Record<string, boolean> | null | undefined, key: string) => modules?.[key] !== false;
