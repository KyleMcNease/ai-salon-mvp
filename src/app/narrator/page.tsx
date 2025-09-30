'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ArxivLookupResult } from '@/types/arxiv';
import type { Pdf2AudioResult } from '@/types/pdf2audio';

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

export default function NarratorPage() {
  const [url, setUrl] = useState('');
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useServerVoice, setUseServerVoice] = useState(false);
  const [usePdf2Audio, setUsePdf2Audio] = useState(false);
  const [pdf2AudioResult, setPdf2AudioResult] = useState<Pdf2AudioResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [arxivMeta, setArxivMeta] = useState<ArxivLookupResult | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const selectedSection = useMemo(() => sections.find((sec) => sec.id === selectedId) ?? null, [sections, selectedId]);

  const stopBrowserSpeech = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
  }, []);

  useEffect(() => {
    const audioElement = audioRef.current;
    return () => {
      stopBrowserSpeech();
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
    };
  }, [stopBrowserSpeech]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) {
      setError('Paste a URL to extract.');
      return;
    }

    setLoading(true);
    setError(null);
    setSections([]);
    setSelectedId(null);
    setPdf2AudioResult(null);
    setWarnings([]);
    setArxivMeta(null);

    try {
      const res = await fetch('/api/narrator/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          options: {
            usePdf2Audio,
          },
        }),
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const payload = await res.json();
          if (payload?.error) detail = payload.error as string;
        } catch (_) {
          /* ignore */
        }
        throw new Error(detail);
      }

      const data = (await res.json()) as ExtractResponse;
      setSections(data.sections);
      if (data.sections.length) {
        setSelectedId(data.sections[0].id);
      }
      if (data.pdf2audio) {
        setPdf2AudioResult(data.pdf2audio);
      }
      if (data.warnings) {
        setWarnings(data.warnings);
      }
      if (data.arxiv) {
        setArxivMeta(data.arxiv);
      }
    } catch (err: any) {
      setError(err?.message || 'Extraction failed');
    } finally {
      setLoading(false);
    }
  };

  const pauseBrowser = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.pause();
  }, []);

  const resumeBrowser = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.resume();
  }, []);

  const speakBrowser = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        setError('SpeechSynthesis not supported in this browser.');
        return;
      }
      stopBrowserSpeech();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [stopBrowserSpeech]
  );

  const speakServer = useCallback(async (text: string) => {
    setError(null);
    try {
      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId: 'gpt' }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const payload = await res.json();
          if (payload?.error) detail = payload.error as string;
        } catch (_) {
          /* ignore */
        }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play();
      }
    } catch (err: any) {
      setError(err?.message || 'TTS request failed');
    }
  }, []);

  const handleSpeak = () => {
    if (!selectedSection) return;
    stopBrowserSpeech();
    if (useServerVoice) {
      void speakServer(selectedSection.text);
    } else {
      speakBrowser(selectedSection.text);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="p-6 border-b bg-white">
        <h1 className="text-2xl font-semibold">AI Salon Narrator</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Extract long-form documents and play them back with browser speech or the Salon voice service.
        </p>
      </header>

      <section className="max-w-5xl mx-auto p-6 space-y-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/research-paper"
            className="flex-1 border rounded px-3 py-2"
            required
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            disabled={loading}
          >
            {loading ? 'Extracting…' : 'Extract'}
          </button>
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={useServerVoice}
              onChange={(e) => setUseServerVoice(e.target.checked)}
            />
            Use AI Salon voice
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={usePdf2Audio}
              onChange={(e) => setUsePdf2Audio(e.target.checked)}
            />
            GPT-enhanced script
          </label>
        </form>

        {error && <div className="text-sm text-red-600">{error}</div>}
        {warnings.length > 0 && (
          <ul className="text-xs text-amber-600 space-y-1">
            {warnings.map((warn) => (
              <li key={warn}>⚠ {warn}</li>
            ))}
          </ul>
        )}
        {arxivMeta && (
          <div className="border rounded p-3 bg-white text-sm text-neutral-700 space-y-1">
            <div className="text-xs uppercase tracking-wide text-neutral-500">arXiv metadata</div>
            {arxivMeta.title && <div className="font-semibold text-neutral-800">{arxivMeta.title}</div>}
            {arxivMeta.authors && arxivMeta.authors.length > 0 && (
              <div>
                <span className="text-neutral-500">Authors:</span> {arxivMeta.authors.join(', ')}
              </div>
            )}
            {arxivMeta.summary && (
              <details>
                <summary className="cursor-pointer text-neutral-600">Abstract</summary>
                <p className="mt-1 whitespace-pre-wrap text-neutral-700">{arxivMeta.summary}</p>
              </details>
            )}
            <div className="flex flex-wrap gap-2 text-xs text-blue-600">
              {arxivMeta.absUrl && (
                <a href={arxivMeta.absUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  View abstract
                </a>
              )}
              {arxivMeta.pdfUrl && (
                <a href={arxivMeta.pdfUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Download PDF
                </a>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <aside className="border rounded p-3 bg-white max-h-[70vh] overflow-y-auto">
            <h2 className="font-semibold text-sm text-neutral-600 mb-2">Contents</h2>
            <ul className="space-y-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(section.id)}
                    className={`w-full text-left px-2 py-1 rounded text-sm ${
                      selectedId === section.id ? 'bg-blue-100 text-blue-700' : 'hover:bg-neutral-100'
                    }`}
                  >
                    {section.title || 'Untitled section'}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <article className="border rounded p-4 bg-white space-y-3">
            <header className="space-y-2">
              <h2 className="text-lg font-semibold text-neutral-800">
                {selectedSection?.title || 'Select a section'}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={handleSpeak}
                  disabled={!selectedSection}
                >
                  ▶ Speak
                </button>
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={pauseBrowser}
                >
                  ⏸ Pause
                </button>
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={resumeBrowser}
                >
                  ⏵ Resume
                </button>
                <button
                  type="button"
                  className="px-2 py-1 border rounded"
                  onClick={stopBrowserSpeech}
                >
                  ■ Stop
                </button>
              </div>
            </header>

            <textarea
              className="w-full min-h-[280px] border rounded p-3 text-sm leading-relaxed"
              value={selectedSection?.text || ''}
              readOnly
            />

            <audio ref={audioRef} controls className="w-full" />
          </article>

          {pdf2AudioResult?.script && (
            <aside className="border rounded p-4 bg-white space-y-3 md:col-span-2">
              <header className="space-y-1">
                <h2 className="text-lg font-semibold text-neutral-800">GPT-prepared Script</h2>
                <p className="text-xs text-neutral-500">
                  Generated via PDF2Audio for smoother narration (experimental).
                </p>
              </header>
              <textarea
                className="w-full min-h-[240px] border rounded p-3 text-sm leading-relaxed"
                value={pdf2AudioResult.script}
                readOnly
              />
              {pdf2AudioResult.segments && pdf2AudioResult.segments.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm text-neutral-600">View segments</summary>
                  <ul className="mt-2 space-y-2 text-sm text-neutral-700">
                    {pdf2AudioResult.segments.map((segment, idx) => (
                      <li key={`${segment.title ?? 'segment'}-${idx}`} className="border rounded p-2 bg-neutral-50">
                        {segment.title && <div className="font-semibold">{segment.title}</div>}
                        <div>{segment.text}</div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}
