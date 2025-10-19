export type PromptToken = {
  raw: string;
  token: string;
};

export type PromptScanResult = {
  mentionTokens: PromptToken[];
  toolTokens: PromptToken[];
};

const MENTION_REGEX = /@([A-Za-z0-9_.\-/]+)/g;
const TOOL_REGEX = /#(?:tool|tools)[:=]([A-Za-z0-9_.-]+)/gi;

export function scanPromptTokens(input: string): PromptScanResult {
  const mentionTokens: PromptToken[] = [];
  const toolTokens: PromptToken[] = [];

  for (const match of input.matchAll(MENTION_REGEX)) {
    mentionTokens.push({ raw: match[0], token: match[1] ?? '' });
  }

  for (const match of input.matchAll(TOOL_REGEX)) {
    const token = match[1] ?? '';
    if (!token) continue;
    toolTokens.push({ raw: match[0], token: token.toLowerCase() });
  }

  return { mentionTokens, toolTokens };
}
