import type { PrismaClient } from "@prisma/client";
export const accountKey:string;
export function sealKey(key:string,farmId:string):string;
export function openKey(ciphertext:string,farmId:string):string;
export function discover(key:string):Promise<{device:string;sku:string;label:string;type:string;temperature:boolean}[]>;
export function readSensor(key:string,sensor:{device:string;sku:string;name:string;unit:"F"|"C"},farmId:string,prisma:PrismaClient):Promise<{temperatureC:number;humidityPercent:number|null;readAt:Date}|null>;

export function goveeApi(key:string,path:string,payload?:{device:string;sku:string}):Promise<{payload?:{device:string;sku:string;capabilities?:{instance:string;state?:{value?:unknown}}[]}}>;