export type MemoryItem = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
};

const mem: MemoryItem[] = [];

export function appendMemory(item: MemoryItem) {
  mem.push(item);
}

export function getMemory(limit = 100): MemoryItem[] {
  return mem.slice(-limit);
}
