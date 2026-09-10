import * as error from '@/api/http/middleware/error.middleware'
import * as global from '@/api/http/middleware/request.middleware'
import * as auth from '@/api/http/middleware/auth.middleware'

export default {
  error: error.errorHandler,
  global: global.globalHandler,
  auth: auth.authHandler,
  authMaster: auth.authMasterHandler
}