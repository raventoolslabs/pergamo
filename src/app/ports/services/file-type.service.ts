export interface FileTypeCheck {
  /** false cuando no hay firma conocida para ese mimetype. */
  verifiable: boolean;
  matches: boolean;
}

export interface FileTypeVerifier {
  verify(filePath:string, mimetype:string): Promise<FileTypeCheck>;
}
