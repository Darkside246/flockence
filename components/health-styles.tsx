const healthCss = `
.health-tabs{display:flex;gap:5px;overflow:auto;padding:4px;background:var(--surface-soft);border:1px solid var(--line);border-radius:16px}
.tab{border:0;background:transparent;color:var(--muted);padding:10px 14px;border-radius:12px;font-size:11px;font-weight:800;white-space:nowrap}
.tab.active{background:var(--surface-solid);color:var(--ink);box-shadow:0 3px 12px rgba(0,0,0,.06)}
.metric{min-height:130px;display:flex;flex-direction:column;justify-content:space-between}
.metric span,.metric small{color:var(--muted);font-size:11px}
.metric strong{font-size:30px;letter-spacing:-.04em}
.alert{padding:17px 19px;border-radius:18px;border:1px solid var(--line);background:var(--surface)}
.alert p{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.5}
.alert.danger{border-color:color-mix(in srgb,var(--danger) 26%,var(--line));background:var(--danger-soft)}
.check-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.check{display:flex;align-items:center;gap:8px;padding:10px 11px;border:1px solid var(--line);border-radius:12px;background:var(--surface-solid);font-size:10px!important;color:var(--ink)!important;font-weight:700!important}
.check input{width:auto}
.guidance{background:linear-gradient(135deg,var(--primary-soft),var(--surface-solid))}
.tag-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.tag{padding:7px 9px;border-radius:999px;background:var(--surface-solid);border:1px solid var(--line);font-size:10px}
.notice-card{background:color-mix(in srgb,var(--primary-soft) 42%,var(--surface-solid))}
.pill{display:inline-block!important;width:max-content;padding:6px 8px;border-radius:999px;background:var(--primary-soft);color:var(--primary)!important;font-size:9px!important;font-weight:900}
.pill.high,.pill.urgent{background:var(--danger-soft);color:var(--danger)!important}
.pill.active{background:var(--accent-soft);color:var(--warning)!important}
@media(max-width:800px){.check-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.row{grid-template-columns:1fr 1fr}.row>div:first-child{grid-column:1/-1}.theme-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:480px){.main{width:calc(100% - 20px)}.check-grid{grid-template-columns:1fr}.grid2{grid-template-columns:1fr}.health-tabs{position:sticky;top:137px;z-index:18}.metric strong{font-size:26px}}
`;

export function HealthStyles() {
  return <style>{healthCss}</style>;
}
