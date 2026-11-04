export const policyKey = "ROUNDS::policy";
export const defaultPolicy = {enabled:false,first:"20:00",deadline:"22:00",interval:30,zone:"America/Barbados",email:true,whatsapp:true,emailUserId:""};
export type Policy = typeof defaultPolicy;
export function validPolicy(p:Policy) {
  if (!p || (p.emailUserId!=null && (typeof p.emailUserId!=="string" || p.emailUserId.length>100)) || ![p.enabled,p.email,p.whatsapp].every(x=>typeof x==="boolean") || ![30,45,60].includes(p.interval) ||
    ![p.first,p.deadline].every(x=>typeof x==="string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x)) || p.first>p.deadline ||
    typeof p.zone!=="string" || p.zone.length>80 || !p.zone || (p.enabled && !p.email && !p.whatsapp)) return false;
  try {new Intl.DateTimeFormat("en",{timeZone:p.zone});return true;} catch{return false;}
}
export function farmClock(now:Date,zone:string) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:parts.year+"-"+parts.month+"-"+parts.day, time:parts.hour+":"+parts.minute};
}
export function reminderSlot(time:string,p:Policy) {
  if(!p.enabled || time<p.first || time>p.deadline)return null;
  const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
  const elapsed=minutes(time)-minutes(p.first);
  return Math.floor(elapsed/p.interval);
}
