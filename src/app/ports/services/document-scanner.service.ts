export interface ScanVerdict {
  infected: boolean;
  signature?: string;
  engine: string;
}

export interface DocumentScanner {
  init(): Promise<void>;
  check(filePath:string): Promise<ScanVerdict>;
}

export interface ActiveContentResult {
  active: boolean;
  markers: string[];
}

/**
 * Segunda capa, complementaria al antivirus: busca lo que el PDF hace al visor,
 * que no lleva firma porque no es malware.
 */
export interface ActiveContentDetector {
  detect(filePath:string, mimetype:string): Promise<ActiveContentResult>;
  signature(markers:string[]): string;
}
