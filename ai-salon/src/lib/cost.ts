export type Cost = { model: string; inputPer1k: number; outputPer1k: number };
export const COSTS: Cost[] = [
  { model: 'gpt-5', inputPer1k: 0.01, outputPer1k: 0.03 },
];
