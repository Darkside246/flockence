export type FarmDeletion = { requestedAt: string; deleteAfter: string; requestedBy: string };
export type DeletionStatus = { pending: false } | { pending: true; deleteAfter: string; daysLeft: number; due: boolean };
export const GRACE_DAYS: number;
export function parseDeletion(value: string | null | undefined): FarmDeletion | null;
export function newDeletion(now: Date, userId: string): FarmDeletion;
export function deletionStatus(deletion: FarmDeletion | null, now: Date): DeletionStatus;
export function confirmsFarmName(typed: unknown, farmName: string): boolean;
export function canDeleteFarm(farmId: string, homeFarmId: string): boolean;
