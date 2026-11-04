import test from "node:test";
import assert from "node:assert/strict";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test")) throw Error("Test database required");
process.env.FARM_ID = "cam-test-"+crypto.randomUUID();
process.env.AUTH_SECRET ??= "t".repeat(40);
const {prisma} = await import("../lib/prisma.ts");
const {runAsFarm,runUnscoped,DEFAULT_FARM_ID} = await import("../lib/farm-scope.ts");
const {createSession} = await import("../lib/auth.ts");
const wall = await import("../app/api/camera-wall/route.ts");
const pens = await import("../app/api/pen-config/route.ts");
const batches = await import("../app/api/batches/route.ts");
const daily = await import("../app/api/daily-flock-check/route.ts");
const id = DEFAULT_FARM_ID;
test("user camera layouts, legacy pen reconciliation, protected flocks and daily measurement ownership",async()=>{
  await runUnscoped(()=>prisma.farm.upsert({where:{id},create:{id,name:"Camera test"},update:{}}));
  async function user() {
    const email = crypto.randomUUID()+"@example.test";
    const u = await runAsFarm(id,()=>prisma.user.create({data:{farmId:id,name:"Tester",role:"OWNER",email}}));
    return (await runAsFarm(id,()=>createSession(u.id))).token;
  }
  const a=await user(), b=await user();
  const req=(token,body,query="")=>new Request("http://localhost/test"+query,{method:body?"POST":"GET",
    headers:{cookie:"chicken_op_session="+token,"content-type":"application/json"},body:body?JSON.stringify(body):undefined});
  const slots=["Pen","Door",null,null];
  assert.equal((await wall.PUT(req(a,slots))).status,200);
  assert.deepEqual(await (await wall.GET(req(a))).json(),slots);
  assert.deepEqual(await (await wall.GET(req(b))).json(),[null,null,null,null]);
  const pen=crypto.randomUUID();
  await runAsFarm(id,()=>prisma.setting.create({data:{farmId:id,key:"PENCFG::old::"+pen,value:JSON.stringify({name:pen})}}));
  const shared=await (await pens.GET(req(b))).json();
  assert.ok(shared.some(r=>r.name===pen));
  const make=async()=>{const r=await batches.POST(req(a,{name:"Test flock",startDate:"2026-01-01",initialChicks:20}));const body=await r.json();assert.equal(r.status,201,JSON.stringify(body));return body.id;};
  const empty=await make();assert.equal((await batches.DELETE(req(a,null,"?id="+empty))).status,200);
  const flock=await make(), date="2026-01-05";
  const sample=await runAsFarm(id,()=>prisma.weightRecord.create({data:{batchId:flock,date:new Date(date),quantity:1,avgWeightKg:0.6,scope:"SAMPLE",liveOrDressed:"LIVE"}}));
  for(const avgWeightKg of [0.8,0.9]){
    const r=await daily.POST(req(a,{batchId:flock,date,avgWeightKg,weightSampleQuantity:2}));
    assert.ok(r.ok,await r.text());
  }
  const rows=await runAsFarm(id,()=>prisma.weightRecord.findMany({where:{batchId:flock}}));
  assert.equal(rows.length,2);assert.equal(Number(rows.find(r=>r.id===sample.id).avgWeightKg),0.6);
  assert.equal((await batches.DELETE(req(a,null,"?id="+flock))).status,409);
});
