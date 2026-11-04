"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { TaskPanel } from "@/components/task-panel";
import { CameraWall, type CameraWallStatus } from "@/components/camera-wall";
import { EnvWidgets } from "@/components/env-widgets";
import { ProductionPanels } from "@/components/production-panels";
import { FlockTimeline } from "@/components/flock-timeline";
import { DashboardHero, type HeroChip } from "@/components/dashboard-hero";
import { CxIcon } from "@/components/cx-icons";

type Dashboard={liveBirds:number;liveBroilerBirds:number;liveLayerBirds:number;activeBroilerFlocks:number;activeLayerFlocks:number;activeBatches:number;mortalityCount:number;mortalityRate:number|null;salesTotal:number;cashCollected:number;expenseTotal:number;inventoryValue:number;householdValue:number;economicProfit:number;farmScore:number;alerts:string[]};
type WeatherState={configured:boolean;reason?:string;weather?:{location:{name:string};current:{tempC:number;feelsLikeC:number;humidityPercent:number;windKph:number;condition:string;heatRisk:"LOW"|"WATCH"|"HIGH"};heatAdvice:string;forecast:{time:string;tempC:number;humidityPercent:number;rainChancePercent:number;heatRisk:"LOW"|"WATCH"|"HIGH"}[]}};
type LifecycleRow={batch:{id:string;name:string;status:string};lifecycle:{ageDays:number;ageWeeks:number;daysToAgeTarget:number;ageTargetDate:string;projectedWeightDate:string|null;adgKgPerDay:number|null;weightReady:boolean;recommendation:string;isBeyondSixWeeks:boolean};latestDailyCheck:any;withdrawalBlocked:boolean;withdrawalBlockers:any[]};
type Procurement={feed:{onHandEstimateKg:number;averageDailyUsageKg:number;projectedNeedToAgeTargetKg:number;safetyStockKg:number;reorderRecommendationKg:number;reorderRecommended:boolean}}; type ActionQueue={actions:{id:string;priority:"URGENT"|"HIGH"|"MODERATE"|"LOW";title:string;detail:string;href:string;dueAt?:string|null}[];openActionCount:number};
type DailyRound={date:string;coverage:{activeFlocks:number;recordedFlocks:number;missingFlocks:number};totals:{liveBirdsWithChecks:number;feedKg:number;waterLiters:number;waterToFeedRatio:number|null;mortalityCount:number;mortalityRecords:number;sentToProcessor:number;slaughtered:number;condemned:number;slaughterRecords:number;heatWelfareFlags:number;withdrawalHolds:number};flocks:{id:string;name:string;productionType:string|null;species:string;checkedToday:boolean;liveCount:number|null;feedKg:number|null;waterLiters:number|null;waterToFeedRatio:number|null;feedKgPerLiveBird:number|null;waterLitersPerLiveBird:number|null;avgWeightKg:number|null;temperatureC:number|null;humidityPercent:number|null;ammoniaPpm:number|null;litterCondition:string|null;pantingObserved:boolean;wingSpreadingObserved:boolean;notes:string|null;withdrawalHold:boolean;withdrawalProducts:string[]}[]};
const money=(n:number)=>new Intl.NumberFormat("en-BB",{style:"currency",currency:"BBD"}).format(n/100);

function Icon({name}:{name:string}){const paths:Record<string,string>={bell:"M6 8a2 2 0 0 1 4 0c0 3 1 3 2 4H4c1-1 2-1 2-4ZM5 14h6",search:"M11 11 15 15M6.8 11.5a4.7 4.7 0 1 1 0-9.4 4.7 4.7 0 0 1 0 9.4",plus:"M8 3v10M3 8h10",bird:"M3 9c0-3 2-5 5-5 2 0 4 1 5 3v2H9l-1 3H5v-3H3V9Z",eggs:"M8 2.2c-2.2 0-4.6 3.8-4.6 7.1A4.6 4.6 0 0 0 8 13.8a4.6 4.6 0 0 0 4.6-4.5C12.6 6 10.2 2.2 8 2.2Z",package:"M2.5 5 8 2l5.5 3v6L8 14l-5.5-3zM2.5 5 8 8l5.5-3M8 8v6",feed:"M3 5h10v7H3zM5 3h6v2H5zM5 12v2M11 12v2",money:"M3 4h10v8H3zM5 8a3 3 0 0 1 6 0 3 3 0 0 1-6 0Z"};return <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]??paths.bird}/></svg>}

const quick=[
  ["plus","New batch","Start a production flock","/batches#new"],
  ["bird","Record mortality","Log birds lost today","/operations"],
  ["feed","Add feed","Purchase or usage entry","/finances#feed"],
  ["money","Record sale","Chicken, parts or customer sale","/finances#sale"],
  ["eggs","Record eggs","Enter and grade today’s layer collection","/layers"],
  ["package","Pack eggs","Turn graded stock into carton lots","/layers/packing"]
] as const;

export default function Home(){
  const[data,setData]=useState<Dashboard|null>(null); const[weather,setWeather]=useState<WeatherState|null>(null); const[lifecycle,setLifecycle]=useState<LifecycleRow[]>([]); const[procurement,setProcurement]=useState<Procurement|null>(null); const[actionQueue,setActionQueue]=useState<ActionQueue|null>(null); const[dailyRound,setDailyRound]=useState<DailyRound|null>(null);
  useEffect(()=>{fetch("/api/dashboard").then(async r=>{if(!r.ok)throw new Error("Dashboard unavailable");return r.json()}).then(setData).catch(()=>setData(null)); fetch("/api/weather").then(r=>r.json()).then(setWeather).catch(()=>setWeather({configured:false,reason:"Weather unavailable"})); fetch("/api/lifecycle").then(r=>r.json()).then(setLifecycle).catch(()=>setLifecycle([])); fetch("/api/procurement").then(r=>r.json()).then(setProcurement).catch(()=>setProcurement(null)); fetch("/api/action-queue").then(r=>r.json()).then(setActionQueue).catch(()=>setActionQueue(null)); fetch("/api/daily-round").then(r=>r.json()).then(setDailyRound).catch(()=>setDailyRound(null));},[]);
  const[camStatus,setCamStatus]=useState<CameraWallStatus>({state:"loading",count:0});
  const checked=(dailyRound?.flocks??[]).filter(f=>f.checkedToday);
  const avgOf=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
  const envTemp=avgOf(checked.filter(f=>f.temperatureC!=null).map(f=>f.temperatureC as number));
  const envHum=avgOf(checked.filter(f=>f.humidityPercent!=null).map(f=>f.humidityPercent as number));
  const ammoniaReadings=checked.filter(f=>f.ammoniaPpm!=null).map(f=>f.ammoniaPpm as number);
  const envAmmonia=ammoniaReadings.length?Math.max(...ammoniaReadings):null;
  const mortality=data?.mortalityRate==null?null:data.mortalityRate*100;
  const sales=data?.salesTotal??0;
  const costs=data?.expenseTotal??0;
  const inventory=data?.inventoryValue??0;
  const maxFinancial=Math.max(sales,costs,inventory,1);
  const donutDeg=mortality==null?0:Math.max(0,Math.min(360,mortality/10*360));
  const livePct=data?.liveBirds && data.activeBatches ? 100 : 0;
  const lossPct=data?.mortalityCount ? Math.min(100,(data.mortalityCount/Math.max(data.liveBirds+data.mortalityCount,1))*100) : 0;
  const stockPct=data?.inventoryValue ? Math.min(100,data.inventoryValue/maxFinancial*100) : 0;
  const salesPct=data?.salesTotal ? Math.min(100,data.salesTotal/maxFinancial*100) : 0;
  const heroChips:HeroChip[]=[
    {label:`Farm data ${data?"connected":"unavailable"}`,tone:data?"ok":"warn"},
    {label:camStatus.state==="loading"?"Cameras checking":camStatus.state==="unavailable"?"Cameras unavailable":camStatus.count?`${camStatus.count} camera${camStatus.count===1?"":"s"} connected`:"No cameras connected",tone:camStatus.state==="ready"?(camStatus.count?"ok":"off"):camStatus.state==="loading"?"off":"warn"},
    {label:`Weather ${weather?.configured?"online":"not set up"}`,tone:weather?.configured?"ok":"off"},
    {label:"Sensors not connected",tone:"off"},
  ];
  return <div className="shell">
    <Nav/>
    <main className="main">
      <DashboardHero chips={heroChips} actions={quick} />

      <section className="cx-kpis" aria-label="Key farm figures">
        <div className="card cx-kpi"><span className="cx-kpi-icon"><CxIcon name="bird" size={17}/></span><div className="metric-label">Live broilers</div><div className="metric-value">{data?.liveBroilerBirds?.toLocaleString()??"—"}</div><div className="cx-foot">{data?.activeBroilerFlocks??"—"} meat flocks active</div></div>
        <div className="card cx-kpi"><span className="cx-kpi-icon"><CxIcon name="eggs" size={17}/></span><div className="metric-label">Live layers</div><div className="metric-value">{data?.liveLayerBirds?.toLocaleString()??"—"}</div><div className="cx-foot">{data?.activeLayerFlocks??"—"} egg flocks active</div></div>
        <div className="card cx-kpi"><span className="cx-kpi-icon"><CxIcon name="flock" size={17}/></span><div className="metric-label">Active flocks</div><div className="metric-value">{data?.activeBatches??"—"}</div><div className="cx-foot">broiler and layer production</div></div>
        <div className="card cx-kpi"><span className="cx-kpi-icon"><CxIcon name="pulse" size={17}/></span><div className="metric-label">Mortality</div><div className="metric-value">{mortality==null?"—":`${mortality.toFixed(1)}%`}</div><div className="cx-foot">{data?.mortalityCount??0} recorded losses</div></div>
        <div className="card cx-kpi"><span className="cx-kpi-icon"><CxIcon name="money" size={17}/></span><div className="metric-label">Economic profit</div><div className="metric-value">{data?money(data.economicProfit):"—"}</div><div className="cx-foot">current economic position</div></div>
        <div className="card cx-kpi"><span className="cx-kpi-icon"><CxIcon name="gauge" size={17}/></span><div className="metric-label">Operations score</div><div className="metric-value">{data?data.farmScore:"—"}</div><div className="cx-foot">from recorded farm data</div></div>
      </section>

      <section className="cx-section"><CameraWall onStatus={setCamStatus}/></section>

      <section className="cx-section">
        <div className="cx-section-head"><div><div className="hero-kicker">Environment</div><h3>Today&apos;s house conditions</h3><p>{dailyRound?`Recorded in today's flock checks · ${dailyRound.coverage.recordedFlocks} of ${dailyRound.coverage.activeFlocks} flocks checked`:"Loading today's recorded readings."}</p></div><a className="button" href="/operations">Daily check →</a></div>
        <EnvWidgets temperatureC={envTemp} humidityPercent={envHum} ammoniaPpm={envAmmonia} feedKg={dailyRound&&dailyRound.coverage.recordedFlocks>0?dailyRound.totals.feedKg:null} waterLiters={dailyRound&&dailyRound.coverage.recordedFlocks>0?dailyRound.totals.waterLiters:null} waterToFeedRatio={dailyRound?.totals.waterToFeedRatio??null} flocksReporting={dailyRound?.coverage.recordedFlocks??0} flocksActive={dailyRound?.coverage.activeFlocks??0} />
      </section>

      <section className="cx-section">
        <div className="cx-section-head"><div><div className="hero-kicker">Production</div><h3>Broilers and layers</h3><p>Meat and egg production are tracked separately, from recorded data only.</p></div></div>
        <ProductionPanels data={data} flocks={dailyRound?.flocks??[]} lifecycle={lifecycle as never} />
      </section>

      <section className="section panel-grid"><div className="card chart-card"><div className="section-head"><div><div className="hero-kicker">Recorded operations</div><h3>Farm data flow</h3><p>Only measures already recorded in Flockence are shown.</p></div><select className="select-pill" defaultValue="current"><option value="current">Current farm</option></select></div>{data ? <div className="pipeline">{[["Live birds",livePct],["Losses",lossPct],["Inventory",stockPct],["Sales",salesPct]].map(([label,height])=><div className="pipe-col" key={String(label)}><strong>{label==="Live birds"?data.liveBirds:label==="Losses"?data.mortalityCount:label==="Inventory"?money(inventory):money(sales)}</strong><div className={`pipe-bar${Number(height)===0?" muted":""}`} style={{height:`${Math.max(10,Number(height))}%`}}/><span>{label}</span></div>)}</div> : <div className="empty-chart"><div><strong>Waiting for recorded farm data</strong><span>Once batches, losses, inventory or sales exist, this view becomes graphical automatically.</span></div></div>}</div>
        <div className="card chart-card"><div className="section-head"><div><div className="hero-kicker">Flock health</div><h3>Mortality monitor</h3><p>Actual recorded mortality only.</p></div><span className="badge">{mortality==null?"NO DATA":"RECORDED"}</span></div><div className="donut-wrap"><div className="donut" style={{background:`conic-gradient(var(--primary) 0deg ${donutDeg}deg, var(--donut-track,#e9eee7) ${donutDeg}deg 360deg)`}}><div className="donut-label"><strong>{mortality==null?"—":mortality.toFixed(1)+"%"}</strong><span>mortality</span></div></div><div className="legend"><div className="legend-row"><span className="legend-left"><i className="legend-dot"/>Live birds</span><strong>{data?.liveBirds?.toLocaleString()??"—"}</strong></div><div className="legend-row"><span className="legend-left"><i className="legend-dot warn"/>Recorded losses</span><strong>{data?.mortalityCount??"—"}</strong></div><div className="legend-row"><span className="legend-left"><i className="legend-dot danger"/>Data basis</span><strong>Actual only</strong></div></div></div></div></section>

      <section className="section panel-grid"><div className="card chart-card"><div className="section-head"><div><div className="hero-kicker">Farm economics</div><h3>Where the money is</h3><p>Sales, operating costs and inventory value from actual records.</p></div><select className="select-pill" defaultValue="actual"><option value="actual">Actual data</option></select></div><div className="finance-bars"><div className="finance-row"><div className="finance-head"><span>Sales</span><strong>{data?money(sales):"—"}</strong></div><div className="bar-track"><div className="bar-fill" style={{width:`${sales/maxFinancial*100}%`}}/></div></div><div className="finance-row"><div className="finance-head"><span>Economic costs</span><strong>{data?money(costs):"—"}</strong></div><div className="bar-track"><div className="bar-fill cost" style={{width:`${costs/maxFinancial*100}%`}}/></div></div><div className="finance-row"><div className="finance-head"><span>Inventory value</span><strong>{data?money(inventory):"—"}</strong></div><div className="bar-track"><div className="bar-fill inventory" style={{width:`${inventory/maxFinancial*100}%`}}/></div></div></div></div><div className="card chart-card"><div className="section-head"><div><div className="hero-kicker">Weather + heat watch</div><h3>Outside conditions</h3><p>Weather is an early warning input. House temperature, humidity and airflow remain the operational truth.</p></div><span className="badge">{weather?.configured&&weather.weather?weather.weather.current.heatRisk:"SETUP"}</span></div>{weather?.configured&&weather.weather?<><div className="stats"><div><span>Location</span><strong>{weather.weather.location.name}</strong></div><div><span>Temperature</span><strong>{weather.weather.current.tempC.toFixed(1)}°C</strong></div><div><span>Humidity</span><strong>{weather.weather.current.humidityPercent.toFixed(0)}%</strong></div><div><span>Wind</span><strong>{weather.weather.current.windKph.toFixed(0)} km/h</strong></div></div><p className="muted" style={{marginTop:14}}>{weather.weather.heatAdvice}</p><p className="muted" style={{fontSize:12,marginTop:6}}>Weather source: <a href="https://www.weatherapi.com/" target="_blank" rel="noreferrer">WeatherAPI.com</a></p><p className="muted" style={{fontSize:12,marginTop:6}}>Weather information is for general informational purposes only. Forecasts and conditions are probabilistic and may not be accurate for this specific location or time. Do not use this weather data as the sole basis for safety-critical decisions. Consult official meteorological services and relevant authorities where accuracy is critical.</p><div className="finance-bars" style={{marginTop:14}}>{weather.weather.forecast.slice(0,6).map(h=><div className="finance-row" key={h.time}><div className="finance-head"><span>{new Date(h.time).toLocaleTimeString("en-BB",{hour:"numeric"})}</span><strong>{h.tempC.toFixed(1)}°C · {h.humidityPercent}%</strong></div><div className="bar-track"><div className={`bar-fill ${h.heatRisk==="HIGH"?"cost":h.heatRisk==="WATCH"?"inventory":""}`} style={{width:`${Math.min(100,Math.max(10,h.tempC/40*100))}%`}}/></div></div>)}</div></>:<div className="empty-chart"><div><strong>{weather?.reason||"Weather location not configured"}</strong><span>Set the farm latitude and longitude in Settings. The provider key stays on the server.</span></div></div>}</div></section>

      <section className="section card"><div className="section-head"><div><div className="hero-kicker">Action queue</div><h3>What needs attention first?</h3><p>Calculated from flock records, health, harvest timing, weather, open orders and cold-chain checks.</p></div><span className="badge">{actionQueue?.openActionCount??"—"} OPEN</span></div>{actionQueue?.actions?.length?<div className="list">{actionQueue.actions.slice(0,10).map(action=><a className="card row" href={action.href} key={action.id}><div><strong>{action.title}</strong><span>{action.detail}</span></div><div><strong>{action.priority}</strong><span>{action.dueAt?new Date(action.dueAt).toLocaleDateString():"Now"}</span></div></a>)}</div>:<div className="empty"><strong>Nothing urgent is calculated right now.</strong><span>Continue the normal farm round and keep your daily records current.</span></div>}</section>
      <section className="cx-section"><FlockTimeline rows={lifecycle as never}/></section>
      {data?.alerts?.length ? <section className="section card alert-card"><div className="section-head"><div><div className="hero-kicker">Needs attention</div><h3>Operations alerts</h3><p>Generated from current recorded farm data.</p></div><span className="badge">{data.alerts.length} OPEN</span></div><div className="alert-list">{data.alerts.map(a=><div className="alert-row" key={a}><div className="alert-icon">!</div><div><strong>{a}</strong><span>Review the related operation record.</span></div><span className="alert-arrow">→</span></div>)}</div></section> : null}

      
      <section className="section card">
        <div className="section-head">
          <div><div className="hero-kicker">Daily farm round</div><h3>What has been recorded today?</h3><p>{dailyRound ? dailyRound.date + " · one pass across the active flock records" : "Loading today's farm-round data."}</p></div>
          <a className="select-pill" href="/operations">Open daily check →</a>
        </div>
        {!dailyRound ? <div className="empty"><strong>Daily Rounds data is not available yet.</strong><span>Open Operations to record the first flock check.</span></div> :
        <>
          <div className="dashboard-grid">
            <div className="card metric-card"><div className="metric-label">Round coverage</div><div className="metric-value">{dailyRound.coverage.recordedFlocks}/{dailyRound.coverage.activeFlocks}</div><div className="metric-foot">{dailyRound.coverage.missingFlocks === 0 ? "All active flocks checked" : dailyRound.coverage.missingFlocks + " flock(s) still missing"}</div></div>
            <div className="card metric-card"><div className="metric-label">Feed used</div><div className="metric-value">{dailyRound.totals.feedKg.toFixed(1)} kg</div><div className="metric-foot">{dailyRound.totals.liveBirdsWithChecks > 0 ? (dailyRound.totals.feedKg / dailyRound.totals.liveBirdsWithChecks * 1000).toFixed(1) + " g per checked bird" : "Live bird count not recorded"}</div></div>
            <div className="card metric-card"><div className="metric-label">Water used</div><div className="metric-value">{dailyRound.totals.waterLiters.toFixed(1)} L</div><div className="metric-foot">{dailyRound.totals.waterToFeedRatio == null ? "Feed and water coverage incomplete" : dailyRound.totals.waterToFeedRatio.toFixed(2) + " L per kg feed"}</div></div>
            <div className="card metric-card"><div className="metric-label">Mortality today</div><div className="metric-value">{dailyRound.totals.mortalityCount.toLocaleString()}</div><div className="metric-foot">{dailyRound.totals.mortalityRecords} mortality record(s)</div></div>
            <div className="card metric-card"><div className="metric-label">Heat / welfare flags</div><div className="metric-value">{dailyRound.totals.heatWelfareFlags}</div><div className="metric-foot">Panting or wing spreading recorded</div></div>
            <div className="card metric-card"><div className="metric-label">Withdrawal holds</div><div className="metric-value">{dailyRound.totals.withdrawalHolds}</div><div className="metric-foot">Treatments affecting today's harvest safety</div></div>
          </div>
          <div className="list" style={{marginTop:16}}>
            {dailyRound.flocks.map(row=><div className="card row" key={row.id}>
              <div>
                <strong>{row.name}</strong>
                <span>{row.checkedToday ? "Daily check recorded" : "Daily check missing"} · {row.productionType === "LAYER" || row.species.toUpperCase() === "LAYER" ? "Layer" : "Broiler / meat"}</span>
                {row.withdrawalHold && <span className="notice notice-danger" role="alert">Withdrawal hold: {row.withdrawalProducts.join(", ")}</span>}
                {(row.pantingObserved || row.wingSpreadingObserved) && <span className="notice" role="status">Welfare signs recorded: {row.pantingObserved ? "panting" : ""}{row.pantingObserved && row.wingSpreadingObserved ? " and " : ""}{row.wingSpreadingObserved ? "wing spreading" : ""}.</span>}
              </div>
              <div>
                <strong>{row.liveCount == null ? "—" : row.liveCount.toLocaleString()} birds</strong>
                <span>{row.feedKg == null ? "Feed not recorded" : row.feedKg.toFixed(1) + " kg feed"}{row.waterLiters == null ? " · Water not recorded" : " · " + row.waterLiters.toFixed(1) + " L water"}</span>
                <span>{row.temperatureC == null ? "Temp not recorded" : row.temperatureC.toFixed(1) + "°C"} · {row.humidityPercent == null ? "RH not recorded" : row.humidityPercent.toFixed(0) + "% RH"}</span>
              </div>
            </div>)}
          </div>
          <p className="muted" style={{marginTop:12}}>These values are recorded observations. The dashboard does not invent feed, water, temperature, mortality or bird counts when the farm has not recorded them.</p>
        </>
        }
      </section>

      <section className="section card"><div className="section-head"><div><div className="hero-kicker">Quick action hub</div><h3>Do the next farm task in a few taps</h3><p>Large targets for fast use in the yard, shed or office.</p></div><a className="select-pill" href="/operations">Open operations →</a></div><div className="quick-hub">{quick.map(([icon,title,desc,href])=><a className="quick-action" href={href} key={title}><span className="quick-icon"><Icon name={icon}/></span><span><strong>{title}</strong><span>{desc}</span></span></a>)}</div></section>

      <section className="section card"><div className="section-head"><div><div className="hero-kicker">Procurement</div><h3>Know when to buy feed</h3><p>Estimate from recorded feed purchases, recent usage and active flock demand.</p></div><span className="badge">{procurement?.feed.reorderRecommended?"REORDER":"OK"}</span></div>{procurement?<div className="stats"><div><span>Estimated feed on hand</span><strong>{procurement.feed.onHandEstimateKg.toFixed(1)} kg</strong></div><div><span>7-day average use</span><strong>{procurement.feed.averageDailyUsageKg.toFixed(1)} kg/day</strong></div><div><span>Projected need</span><strong>{procurement.feed.projectedNeedToAgeTargetKg.toFixed(1)} kg</strong></div><div><span>Suggested reorder</span><strong>{procurement.feed.reorderRecommendationKg.toFixed(1)} kg</strong></div></div>:<div className="empty"><strong>Procurement data not ready.</strong><span>Record feed purchases and usage to activate the recommendation.</span></div>}</section>
      <section className="section grid2"><TaskPanel batches={lifecycle.map(row=>({id:row.batch.id,name:row.batch.name}))}/><div className="card"><div className="section-head"><div><div className="hero-kicker">Today&apos;s priority</div><h3>Use the signals, not the spreadsheets</h3><p>Flockence now brings lifecycle, house checks, withdrawal, weather, procurement, stock and tasks together on the same operating surface.</p></div></div><div className="stats"><div><span>Lifecycle</span><strong>{lifecycle.length} active</strong></div><div><span>Weather</span><strong>{weather?.configured&&weather.weather?weather.weather.current.heatRisk:"not set"}</strong></div><div><span>Feed</span><strong>{procurement?.feed.reorderRecommended?"Reorder":"OK"}</strong></div><div><span>Next action</span><strong>Open Operations</strong></div></div><a className="button button-primary" href="/operations" style={{marginTop:14,display:"inline-block"}}>Open daily operations</a></div></section>
      <section className="section card"><div className="section-head"><div><div className="hero-kicker">Operating loop</div><h3>Two production paths, one farm record</h3><p>Broiler and layer workflows share flock, feed, health, stock and financial records without sharing the wrong production milestones.</p></div></div><div className="grid2"><div><strong>Broilers</strong><div className="flow"><span>CHICKS</span><b>→</b><span>GROWTH</span><b>→</b><span>HARVEST</span><b>→</b><span>PROCESSING</span><b>→</b><span>MEAT STOCK</span><b>→</b><span>SALES</span></div></div><div><strong>Layers</strong><div className="flow"><span>CHICKS</span><b>→</b><span>PULLETS</span><b>→</b><span>LAYING</span><b>→</b><span>COLLECTION</span><b>→</b><span>GRADING</span><b>→</b><span>PACKING</span><b>→</b><span>CARTON LOTS</span><b>→</b><span>SALES</span></div></div></div></section>
    </main>
  </div>
}
