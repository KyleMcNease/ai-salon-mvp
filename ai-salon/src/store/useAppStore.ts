// Minimal in-memory store without external deps.
type Msg = { role: 'user' | 'assistant'; content: string };
const state: { messages: Msg[] } = { messages: [] };
export function push(m: Msg) { state.messages.push(m); }
export function clear() { state.messages.length = 0; }
export function getMessages() { return state.messages.slice(); }
