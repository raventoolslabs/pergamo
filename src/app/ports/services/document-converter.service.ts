import { ConvertedDocument } from '@/domain/entities/chunk';

export interface DocumentConverter {
  // Se graba en index_converter: identifica con que se convirtio cada documento.
  readonly name: string;
  supports(mimetype:string): boolean;
  convert(filePath:string, mimetype:string): Promise<ConvertedDocument>;
}
