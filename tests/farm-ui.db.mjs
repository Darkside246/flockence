import test from "node:test";
import assert from "node:assert/strict";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test")) throw Error("Test database required");
process.env.AUTH_SECRET = "s".repeat(40);
const {prisma} = await import("../lib/prisma.ts");
const {runAsFarm,runUnscoped} = await import("../lib/farm-scope.ts");
const {createSession} = await import("../lib/auth.ts");
const settings = await import("../app/api/settings/route.ts");
const devices = await import("../app/api/device-settings/route.ts");
const me = await import("../app/api/auth/me/route.ts");
const {accountKey,sealKey} = await import("../lib/govee-account.mjs");
const {showDestination} = await import("../lib/farm-operation.ts");
async function account(role="OWNER") {
  const farmId = "ui-test-"+crypto.randomUUID();
  await runUnscoped(()=>prisma.farm.create({data:{id:farmId,name:"UI test"}}));
  const user = await runAsFarm(farmId,()=>prisma.user.create({data:{farmId,name:"Tester",email:crypto.randomUUID()+"@example.test",role}}));
  const token = await runAsFarm(farmId,()=>createSession(user.id));
  return {farmId,token:token.token};
}
const req = (a,method="GET",body) => new Request("http://localhost/api/settings",{
  method,headers:{cookie:"chicken_op_session="+a.token,"content-type":"application/json"},
  body:body===undefined?undefined:JSON.stringify(body)
});
test.after(async()=>{await prisma.$disconnect();});
test("operation choice persists per farm, rejects unsupported values, and preserves role controls",async()=>{
  const a=await account(),b=await account(),reader=await account("READ_ONLY");
  assert.equal((await me.GET(req(a))).status,200);
  assert.equal((await (await me.GET(req(a))).json()).user.operation,null);
  assert.equal((await settings.PUT(req(a,"PUT",{settings:[{key:"poultry_operation",value:"layers"}]}))).status,200);
  assert.equal((await (await me.GET(req(a))).json()).user.operation,"layers");
  assert.equal((await (await me.GET(req(b))).json()).user.operation,null);
  assert.equal((await settings.PUT(req(a,"PUT",{settings:[{key:"poultry_operation",value:"invalid"}]}))).status,400);
  assert.equal((await settings.PUT(req(reader,"PUT",{settings:[{key:"poultry_operation",value:"both"}]}))).status,403);
  assert.equal(showDestination("/layers/packing","broilers"),false);
  assert.equal(showDestination("/planning","layers"),false);
  assert.equal(showDestination("/batches","layers"),true);
  assert.equal(showDestination("/layers",null),true);
});
test("monitoring toggles persist, keep credentials sealed and require an owner and saved sensor",async()=>{
  const a=await account(),b=await account(),reader=await account("READ_ONLY");
  const credential = sealKey("fake-api-key",a.farmId);
  await runAsFarm(a.farmId,()=>prisma.setting.create({data:{farmId:a.farmId,key:accountKey,
    value:JSON.stringify({credential,sensors:[{device:"test-device",sku:"T",name:"Pen",unit:"C"}]})}}));
  const get=async()=>await (await devices.GET(req(a))).json();
  assert.equal((await get()).monitoring,true);
  for(const enabled of [false,true]){
    const response=await devices.POST(req(a,"POST",{action:"monitoring",enabled}));
    assert.equal(response.status,200);
    assert.equal((await get()).monitoring,enabled);
    const saved=await runAsFarm(a.farmId,()=>prisma.setting.findUnique({where:{farmId_key:{farmId:a.farmId,key:accountKey}}}));
    assert.equal(JSON.parse(saved.value).credential,credential);
  }
  assert.equal((await devices.POST(req(a,"POST",{action:"monitoring",enabled:"yes"}))).status,400);
  assert.equal((await devices.POST(req(b,"POST",{action:"monitoring",enabled:true}))).status,400);
  assert.equal((await devices.POST(req(reader,"POST",{action:"monitoring",enabled:true}))).status,403);
  assert.equal(JSON.stringify(await get()).includes(credential),false);
  assert.equal(JSON.stringify(await get()).includes("fake-api-key"),false);
});
