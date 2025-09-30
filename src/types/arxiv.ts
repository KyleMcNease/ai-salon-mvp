export interface ArxivMetadata {
  id: string;
  version?: string;
  title?: string;
  summary?: string;
  authors?: string[];
  published?: string;
  updated?: string;
  pdfUrl?: string;
  absUrl?: string;
}

export interface ArxivLookupResult extends ArxivMetadata {
  rawXml?: string;
}
