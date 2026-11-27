export type Box = [number, number, number, number, number];
export function iou(a: number[], b: number[]): number;
export function confident(boxes: number[][] | null | undefined, minScore?: number): number[][];
export function stillBirds(frames: number[][][], options?: { sameIou?: number; minMovedShare?: number }): number[][];
export function whereInPicture(box: number[]): string;
export function summariseDetections(frames: number[][][], model: string): { model: string; counts: number[]; count: number; still: { where: string; box: number[] }[] };
