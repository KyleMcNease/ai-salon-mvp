type Event = { type: string; payload?: unknown };
type Handler = (e: Event) => void;

const handlers = new Set<Handler>();

export function on(handler: Handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function emit(type: string, payload?: unknown) {
  handlers.forEach(h => h({ type, payload }));
}
