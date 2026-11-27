/** Dashboard sections the owner can show or hide (Settings, Dashboard). Hidden sections are not loaded at all. */
export const DASHBOARD_SECTIONS: { id: string; label: string; hint: string }[] = [
  { id: "briefing", label: "Today on your farm", hint: "Plain-language summary: ages, losses, feed, checks not yet done" },
  { id: "hero", label: "Welcome banner and quick buttons", hint: "Greeting, photo and the main record buttons" },
  { id: "kpis", label: "Key figures", hint: "Live birds, flocks, mortality, profit" },
  { id: "cameras", label: "Cameras and pen sensors", hint: "Camera tiles and live pen readings" },
  { id: "environment", label: "Today's house conditions", hint: "Temperature, humidity, ammonia, feed and water from today's checks" },
  { id: "production", label: "Production", hint: "Broiler and layer panels" },
  { id: "flow", label: "Farm data flow and mortality charts", hint: "Simple charts of recorded figures" },
  { id: "money", label: "Money and weather", hint: "Sales, costs, stock value and outside conditions" },
  { id: "actions", label: "Action queue", hint: "What needs attention first" },
  { id: "timeline", label: "Flock timeline", hint: "Where each broiler flock is in its cycle" },
  { id: "alerts", label: "Operations alerts", hint: "Alerts from the records" },
  { id: "round", label: "Daily farm round", hint: "What has been recorded today" },
  { id: "quickhub", label: "Quick action hub", hint: "Large buttons for common tasks" },
  { id: "procurement", label: "Feed buying", hint: "Feed on hand and when to reorder" },
  { id: "tasks", label: "Tasks", hint: "Task list and today's priority" },
  { id: "loop", label: "How production works", hint: "Explains the broiler and layer paths" },
];
export const DASHBOARD_SECTION_IDS = new Set(DASHBOARD_SECTIONS.map(s => s.id));
