import type { ArxivLookupResult } from '@/types/arxiv';

const ARXIV_ID_REGEX = /^(?:arxiv:)?(?<category>[a-z\-]+\/)?(?<number>\d{4}\.\d{4,5})(?<version>v\d+)?$/i;
const ARXIV_URL_REGEX = /https?:\/\/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)(?:\.pdf)?/i;

function decodeEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function normalizeArxivId(input: string | undefined | null): { id: string; version?: string } | null {
  if (!input) return null;
  const trimmed = input.trim();

  const urlMatch = trimmed.match(ARXIV_URL_REGEX);
  if (urlMatch) {
    return normalizeArxivId(urlMatch[1]);
  }

  const match = trimmed.match(ARXIV_ID_REGEX);
  if (!match || !match.groups) return null;
  const category = match.groups.category ?? '';
  const number = match.groups.number;
  const version = match.groups.version ?? undefined;
  const id = `${category}${number}`;
  return { id, version };
}

export function buildArxivPdfUrl(id: string, version?: string) {
  const cleanId = version ? `${id}${version}` : id;
  return `https://arxiv.org/pdf/${cleanId}.pdf`;
}

export function buildArxivAbsUrl(id: string, version?: string) {
  const cleanId = version ? `${id}${version}` : id;
  return `https://arxiv.org/abs/${cleanId}`;
}

export async function fetchArxivMetadata(input: string): Promise<ArxivLookupResult | null> {
  const normalized = normalizeArxivId(input);
  if (!normalized) return null;

  const { id, version } = normalized;
  const queryUrl = `https://export.arxiv.org/api/query?search_query=id:${encodeURIComponent(id)}&max_results=1`;

  const res = await fetch(queryUrl, {
    headers: {
      'User-Agent': 'ai-salon/0.1 (+https://github.com/KyleMcNease/ai-salon-mvp)',
    },
  });

  if (!res.ok) {
    throw new Error(`arXiv metadata request failed (${res.status})`);
  }

  const xml = await res.text();
  const entryMatch = xml.match(/<entry[\s\S]*?<\/entry>/i);
  if (!entryMatch) {
    return {
      id,
      version,
      pdfUrl: buildArxivPdfUrl(id, version),
      absUrl: buildArxivAbsUrl(id, version),
      rawXml: xml,
    };
  }

  const entry = entryMatch[0];

  const extractTag = (tag: string) => {
    const regex = new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, 'i');
    const match = entry.match(regex);
    return match ? decodeEntities(match[1].trim()) : undefined;
  };

  const extractAuthors = () => {
    const matches = entry.match(/<author>[\s\S]*?<\/author>/gi);
    if (!matches) return undefined;
    const authors: string[] = [];
    for (const author of matches) {
      const nameMatch = author.match(/<name>([\s\S]*?)<\/name>/i);
      if (nameMatch) {
        authors.push(decodeEntities(nameMatch[1].trim()));
      }
    }
    return authors.length ? authors : undefined;
  };

  const title = extractTag('title');
  const summary = extractTag('summary');
  const published = extractTag('published');
  const updated = extractTag('updated');

  let pdfUrl = buildArxivPdfUrl(id, version);
  const linkMatch = entry.match(/<link[^>]+rel="alternate"[^>]*href="([^"]+)"[^>]*>/i);
  const enclosureMatch = entry.match(/<link[^>]+rel="related"[^>]*type="application\/pdf"[^>]*href="([^"]+)"[^>]*>/i);
  if (enclosureMatch && enclosureMatch[1]) {
    pdfUrl = decodeEntities(enclosureMatch[1]);
  } else if (linkMatch && linkMatch[1]) {
    const absUrl = decodeEntities(linkMatch[1]);
    pdfUrl = absUrl.replace('/abs/', '/pdf/') + '.pdf';
  }

  return {
    id,
    version,
    title,
    summary,
    authors: extractAuthors(),
    published,
    updated,
    pdfUrl,
    absUrl: buildArxivAbsUrl(id, version),
    rawXml: xml,
  };
}
