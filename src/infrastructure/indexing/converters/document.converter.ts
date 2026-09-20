import { ConvertedDocument } from '@/domain/entities/chunk';
import { ConversionUnsupportedError } from '@/domain/exceptions/indexing.exception';
import { DocumentConverter } from '@/app/ports/services/document-converter.service';
import { markdownConverter } from '@/infrastructure/indexing/converters/markdown.converter';
import { officeParserConverter } from '@/infrastructure/indexing/converters/officeparser.converter';

const CONVERTERS = [markdownConverter, officeParserConverter];

/**
 * El conversor que ve la indexacion: elige por mimetype. `name` no llega a
 * index_converter —ahi se graba el del que convirtio de verdad, que viene en el
 * documento convertido—, solo identifica a este reparto.
 */
export const documentConverter:DocumentConverter = {

  name: 'document',

  supports: (mimetype) => CONVERTERS.some((converter) => converter.supports(mimetype)),

  convert(filePath, mimetype):Promise<ConvertedDocument> {

    const converter = CONVERTERS.find((candidate) => candidate.supports(mimetype));

    if(!converter) throw new ConversionUnsupportedError(`No converter for mimetype "${mimetype}"`);

    return converter.convert(filePath, mimetype);
  }
};
