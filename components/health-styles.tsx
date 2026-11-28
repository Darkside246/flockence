const healthCss = `
/* Health page only (scoped to .health-page; these rules used to apply to the whole document). */
.health-page .health-metrics { margin: 0 0 var(--space-4); }
.health-page .metric { display: grid; gap: 2px; padding: var(--space-3) var(--space-4); min-height: 0; }
.health-page .metric span, .health-page .metric small { color: var(--ds-text-2); font-size: var(--text-xs); }
.health-page .metric strong { color: var(--ds-text); font-size: var(--text-2xl); font-weight: var(--weight-heavy); line-height: 1.15; font-variant-numeric: tabular-nums; }
.health-page .alert { padding: var(--space-3) var(--space-4); border-radius: var(--ds-card-radius); }
.health-page .alert p { margin: 4px 0 0; color: var(--ds-text-2); font-size: var(--text-sm); line-height: 1.5; }
.health-page .check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr)); gap: 6px; }
.health-page .check { display: flex; align-items: center; gap: var(--space-2); padding: 6px var(--space-2); border: 1px solid var(--ds-border); border-radius: var(--ds-control-radius); background: var(--ds-surface); color: var(--ds-text); font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.health-page .check:has(input:checked) { border-color: var(--ds-accent); background: var(--ds-accent-soft); }
.health-page .check input { width: auto; }
.health-page .guidance { background: var(--ds-accent-soft); }
.health-page .tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: var(--space-2); }
.health-page .tag { padding: 3px 8px; border-radius: var(--radius-pill); background: var(--ds-surface); border: 1px solid var(--ds-border); font-size: var(--text-xs); }
.health-page .notice-card { background: var(--ds-surface-2); box-shadow: none; }
.health-page .pill { display: inline-flex; width: max-content; }
.health-page .pill:is(.high, .urgent) { background: var(--ds-danger-soft); color: var(--ds-danger); border-color: color-mix(in srgb, var(--ds-danger) 35%, var(--ds-border)); }
.health-page .pill.active { background: var(--ds-warning-soft); color: var(--ds-warning); border-color: color-mix(in srgb, var(--ds-warning) 35%, var(--ds-border)); }
@media (max-width: 760px) {
  .health-page .row { grid-template-columns: 1fr 1fr; }
  .health-page .row > div:first-child { grid-column: 1 / -1; }
}
`;

export function HealthStyles() {
  return <style>{healthCss}</style>;
}
