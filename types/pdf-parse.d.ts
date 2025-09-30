declare module 'pdf-parse' {
  interface PDFInfo {
    Title?: string;
    Author?: string;
    Creator?: string;
    Producer?: string;
  }

  interface PDFMetadata {
    [key: string]: unknown;
  }

  interface PDFParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: PDFInfo;
    metadata: PDFMetadata;
    version: string;
  }

  interface PDFParseOptions {
    max?: number;
  }

  function pdfParse(data: Buffer | Uint8Array | ArrayBuffer, options?: PDFParseOptions): Promise<PDFParseResult>;

  export type { PDFInfo, PDFParseResult, PDFParseOptions };
  export default pdfParse;
}
