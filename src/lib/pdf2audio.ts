import type { Pdf2AudioResult } from '@/types/pdf2audio';

interface Pdf2AudioOptions {
  apiUrl?: string;
  apiKey?: string;
  testMode?: boolean;
}

interface Pdf2AudioInput {
  text?: string;
  url?: string;
  filename?: string;
}

type Pdf2AudioPayload = {
  inputs: {
    text?: string;
    url?: string;
    filename?: string;
    test_mode?: boolean;
  };
};

const DEFAULT_ENDPOINT = 'https://huggingface.co/spaces/lamm-mit/PDF2Audio/api/predict';

function buildRequestPayload(input: Pdf2AudioInput, testMode: boolean): Pdf2AudioPayload {
  return {
    inputs: {
      text: input.text,
      url: input.url,
      filename: input.filename,
      test_mode: testMode,
    },
  };
}

export async function runPdf2Audio(
  input: Pdf2AudioInput,
  options: Pdf2AudioOptions = {}
): Promise<Pdf2AudioResult> {
  const apiUrl = options.apiUrl || process.env.PDF2AUDIO_API_URL || DEFAULT_ENDPOINT;
  if (!apiUrl) {
    throw new Error('PDF2AUDIO_API_URL not configured');
  }

  const apiKey = options.apiKey ?? process.env.PDF2AUDIO_API_KEY;
  if (!apiKey) {
    throw new Error('PDF2AUDIO_API_KEY not configured');
  }

  if (!input.text && !input.url) {
    throw new Error('Provide either text or url for PDF2Audio');
  }

  const payload = buildRequestPayload(input, options.testMode ?? true);

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`PDF2Audio request failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as Pdf2AudioResult | { data?: Pdf2AudioResult };

  if ('data' in json && json.data) {
    return json.data as Pdf2AudioResult;
  }

  return json as Pdf2AudioResult;
}
