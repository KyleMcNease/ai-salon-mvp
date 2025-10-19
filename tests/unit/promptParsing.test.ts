import { scanPromptTokens } from '../../src/lib/promptParsing';

describe('scanPromptTokens', () => {
  it('extracts model mentions and raw tokens', () => {
    const input = 'Hello @claude and @gpt in the same sentence';
    const { mentionTokens, toolTokens } = scanPromptTokens(input);

    expect(toolTokens).toHaveLength(0);
    expect(mentionTokens.map((token) => token.token)).toEqual(['claude', 'gpt']);
    expect(mentionTokens.map((token) => token.raw)).toEqual(['@claude', '@gpt']);
  });

  it('extracts tool overrides with case-insensitive prefix', () => {
    const input = 'Run #tools=web.search after @local please';
    const { mentionTokens, toolTokens } = scanPromptTokens(input);

    expect(mentionTokens.map((token) => token.token)).toEqual(['local']);
    expect(toolTokens.map((token) => token.token)).toEqual(['web.search']);
  });

  it('returns empty arrays when no matches present', () => {
    const input = 'Plain prompt without annotations.';
    const { mentionTokens, toolTokens } = scanPromptTokens(input);

    expect(mentionTokens).toHaveLength(0);
    expect(toolTokens).toHaveLength(0);
  });
});
