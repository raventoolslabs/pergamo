import { StatusCodes } from 'http-status-codes';

import { searchDeps as deps } from '@/container';
import { ValidationError } from '@/domain/exceptions/domain.exception';
import { formatIssues } from '@/shared/validation';
import { searchBodySchema, toSearchHitResponse } from '@/api/http/dto/search.dto';
import { searchDocuments } from '@/app/use-cases/search/queries/search-documents.handler';

const search = async (req, res, next) => {

  try {

    const body = searchBodySchema.safeParse(req.body);

    if(!body.success) throw new ValidationError('INVALID_BODY', formatIssues(body.error));

    const { query, limit, min_similarity } = body.data;

    // El ambito sale del token y de ningun otro sitio: no hay forma de pedir
    // que se busque en el fondo de otra organizacion.
    const hits = await searchDocuments({
      organization: req.user.organization,
      query,
      limit,
      minSimilarity: min_similarity
    }, deps);

    res.status(StatusCodes.OK)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        total: hits.length,
        limit,
        results: hits.map(toSearchHitResponse)
      }));

  } catch (error) {
    next(error);
  }
};

export { search };
