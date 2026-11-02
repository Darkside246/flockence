export declare function farmIdForBusiness(businessId: string): string;
export declare function readProvisionRequest(body: unknown): { requestId: string; businessId: string; farmId: string; farmName: string; link: { keyId: string; secret: string } } | null;
export declare function newSignIn(): { state: string; verifier: string; challenge: string };
export declare function sealSignIn(secret: string, value: { state: string; verifier: string }, nowMs?: number): string;
export declare function openSignIn(secret: string, cookie: string | null | undefined, nowMs?: number): { state: string; verifier: string } | null;
export declare function sameState(a: unknown, b: unknown): boolean;
export type OriyaIdentity = { oriyaUserId: string; name: string; role: "OWNER" | "MANAGER" | "WORKER" | "READ_ONLY"; businessId: string; businessName: string; farmId: string };
export declare function readIdentity(json: unknown): OriyaIdentity | null;
export declare function oriyaUserEmail(oriyaUserId: string, farmId: string): string;
