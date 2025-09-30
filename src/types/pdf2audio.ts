export interface Pdf2AudioSegment {
  title?: string;
  text: string;
  start_time?: number;
  end_time?: number;
  summary?: string;
}

export interface Pdf2AudioResult {
  script?: string;
  segments?: Pdf2AudioSegment[];
  highlights?: string[];
  metadata?: Record<string, unknown>;
  raw?: unknown;
}
