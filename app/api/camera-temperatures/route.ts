import {currentUserOrRoleResponse} from "@/lib/current-user";
import {cameraViewRoles,camerasBelongToThisFarm} from "@/lib/camera-guard";
import {prisma} from "@/lib/prisma";

export async function GET(request:Request){
  const access=await currentUserOrRoleResponse(request,cameraViewRoles());
  if(access.response)return access.response;
  if(!camerasBelongToThisFarm())return Response.json({}, {status:403});
  const rows=await prisma.$queryRaw<{sensor:string;temperatureC:string;readAt:Date}[]>`
    SELECT DISTINCT ON ("sensor") "sensor","temperatureC"::text,"readAt"
    FROM "ThermometerReading" WHERE "farmId"=${access.user!.farmId} AND "readAt"<=NOW()
    ORDER BY "sensor","readAt" DESC`;
  return Response.json(rows,{headers:{"Cache-Control":"private, no-store"}});
}
