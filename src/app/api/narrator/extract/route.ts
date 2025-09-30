import { NextRequest } from 'next/server';

import { buildArxivPdfUrl, fetchArxivMetadata, normalizeArxivId } from '@/lib/arxiv';
import { runPdf2Audio } from '@/lib/pdf2audio';
import type { ArxivLookupResult } from '@/types/arxiv';
import type { Pdf2AudioResult } from '@/types/pdf2audio';

export const runtime = 'nodejs';

type Section = {
  id: string;
  title: string;
  text: string;
  start: number | null;
  end: number | null;
};

type ExtractResponse = {
  title: string;
  sections: Section[];
  pdf2audio?: Pdf2AudioResult;
  warnings?: string[];
  arxiv?: ArxivLookupResult;
};

function extractTextFromHtml(buffer: ArrayBuffer) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = decoder.decode(buffer);
  const withoutScripts = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|section|article|header|footer|li|ul|ol)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?\>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n');
  const text = withBreaks.replace(/<[^>]+>/g, '');
  return text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function isLikelyHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^page\s+\d+/i.test(trimmed)) return true;
  if (/^\d+\s+of\s+\d+$/i.test(trimmed)) return true;
  if (trimmed.length <= 12 && /^\d+$/.test(trimmed)) return true;
  if (trimmed.length <= 80 && /^(www\.|https?:)/i.test(trimmed)) return true;
  return false;
}

function cleanupPdfText(raw: string) {
  const lines = raw.split('\n');
  const frequency = new Map<string, number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length > 120) continue;
    if (isLikelyHeader(trimmed)) {
      frequency.set(trimmed, (frequency.get(trimmed) ?? 0) + 1);
    }
  }

  const repeats = new Set<string>();
  const repeatThreshold = Math.max(3, Math.floor(lines.length / 60));
  for (const [line, count] of frequency.entries()) {
    if (count >= repeatThreshold) {
      repeats.add(line);
    }
  }

  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^(figure|table)\s+\d+/i.test(trimmed)) return true;
    if (repeats.has(trimmed)) return false;
    return true;
  });

  let text = filteredLines.join('\n');
  text = text.replace(/-\n(?=[a-z])/g, '');
  text = text.replace(/\n(?=[a-z])/g, ' ');
  text = text.replace(/([a-z])\n(?=[A-Z][a-z])/g, '$1 ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  return text.trim();
}

function looksLikeHeading(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  const canonicalHeadings = /^(\s*(\d+(\.\d+){0,3})\s+)?(abstract|introduction|background|overview|related\s+work|methods?|approach|results?|discussion|analysis|evaluation|conclusion|summary|appendix)\b/i;
  if (canonicalHeadings.test(trimmed)) return true;

  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(trimmed)) return true;
  if (trimmed.length <= 72 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) return true;
  if (/^(appendix|references)\b/i.test(trimmed)) return true;
  return false;
}

function sectionize(text: string): Section[] {
  const lines = text.split(/\n+/);

  const sections: Array<{ title: string; text: string }> = [];
  let buffer: string[] = [];
  let title = 'Overview';

  const push = () => {
    if (!buffer.length) return;
    const textBlock = buffer.join('\n').trim();
    if (!textBlock) {
      buffer = [];
      return;
    }
    sections.push({ title, text: textBlock });
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (looksLikeHeading(line)) {
      push();
      title = line;
      continue;
    }
    buffer.push(line);
  }

  push();

  if (sections.length === 0) {
    return [
      {
        id: 'sec_0',
        title: 'Document',
        text,
        start: 0,
        end: text.length,
      },
    ];
  }

  const results: Section[] = [];
  let cursor = 0;
  sections.forEach((section, index) => {
    const snippet = section.text;
    let start = text.indexOf(snippet, cursor);
    if (start === -1) start = text.indexOf(snippet.replace(/\s+/g, ' '), cursor);
    const end = start >= 0 ? start + snippet.length : null;
    if (start >= 0 && end !== null) {
      cursor = end;
    }
    results.push({
      id: `sec_${index}`,
      title: section.title || `Section ${index + 1}`,
      text: section.text,
      start: start >= 0 ? start : null,
      end,
    });
  });

  return results;
}

async function extractPdfText(buffer: ArrayBuffer): Promise<{ text: string; title?: string }> {
  try {
    const pdfParse = await import('pdf-parse');
    const pdfBuffer = Buffer.from(buffer);
    const parsed = await pdfParse.default(pdfBuffer);
    return {
      text: cleanupPdfText(parsed.text ?? ''),
      title: parsed.info?.Title,
    };
  } catch (error) {
    console.error('PDF parsing failed:', error);
    throw new Error('Failed to parse PDF document');
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? '';

    if (!contentType.includes('application/json')) {
      return new Response('Only JSON payload supported (url or text)', { status: 415 });
    }

    const payload = (await req.json()) as {
      url?: string;
      text?: string;
      options?: {
        usePdf2Audio?: boolean;
        pdf2AudioTestMode?: boolean;
      };
    };

    let sourceText = payload.text?.trim() ?? '';
    let title = 'Document';
    const warnings: string[] = [];
    let pdf2AudioResult: Pdf2AudioResult | undefined;
    let arxivMetadata: ArxivLookupResult | undefined;

    let targetUrl = payload.url?.trim();
    let normalizedArxiv = targetUrl ? normalizeArxivId(targetUrl) : null;
    if (targetUrl && normalizedArxiv) {
      try {
        arxivMetadata = (await fetchArxivMetadata(targetUrl)) ?? undefined;
      } catch (error: any) {
        warnings.push(`arXiv metadata fetch failed: ${error?.message || String(error)}`);
      }
      if (arxivMetadata?.pdfUrl) {
        targetUrl = arxivMetadata.pdfUrl;
      } else {
        targetUrl = buildArxivPdfUrl(normalizedArxiv.id, normalizedArxiv.version);
      }
    }

    if (targetUrl) {
      const res = await fetch(targetUrl, {
        headers: normalizedArxiv
          ? { 'User-Agent': 'ai-salon/0.1 (+https://github.com/KyleMcNease/ai-salon-mvp)' }
          : undefined,
      });
      if (!res.ok) {
        return new Response(`Failed to fetch resource (${res.status})`, { status: 502 });
      }
      const buffer = await res.arrayBuffer();
      const mime = res.headers.get('content-type') ?? '';

      if (mime.includes('pdf') || targetUrl.toLowerCase().endsWith('.pdf')) {
        try {
          const pdfResult = await extractPdfText(buffer);
          sourceText = pdfResult.text;
          title = arxivMetadata?.title ?? pdfResult.title ?? title;
        } catch (error) {
          return new Response('PDF extraction failed: ' + (error as Error).message, { status: 500 });
        }
      } else {
        sourceText = extractTextFromHtml(buffer);
      }

      try {
        const url = new URL(targetUrl);
        if (!arxivMetadata && url.pathname) {
          const last = url.pathname.split('/').filter(Boolean).pop();
          if (last) title = decodeURIComponent(last);
        }
        if (!arxivMetadata && url.hostname) {
          title = `${title} — ${url.hostname}`;
        }
      } catch {
        /* ignore */
      }
    }

    if (!sourceText) {
      return new Response('Provide either url or text to extract', { status: 400 });
    }

    const collapsed = sourceText.replace(/\u00a0/g, ' ').trim();
    const sections = sectionize(collapsed);

    if (title === 'Document' && (arxivMetadata?.title || sections.length > 0)) {
      const fallback = sections.length > 0 ? sections[0].title.slice(0, 120) : title;
      title = arxivMetadata?.title ?? fallback ?? title;
    }

    if (payload.options?.usePdf2Audio) {
      try {
        pdf2AudioResult = await runPdf2Audio(
          {
            text: collapsed,
            url: targetUrl,
          },
          { testMode: payload.options?.pdf2AudioTestMode }
        );
      } catch (error: any) {
        warnings.push(`PDF2Audio preprocessing failed: ${error?.message || String(error)}`);
      }
    }

    const response: ExtractResponse = {
      title,
      sections,
      ...(pdf2AudioResult ? { pdf2audio: pdf2AudioResult } : {}),
      warnings: warnings.length ? warnings : undefined,
      ...(arxivMetadata ? { arxiv: arxivMetadata } : {}),
    };

    return Response.json(response);
  } catch (error: any) {
    const message = error?.message || 'Extraction failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
