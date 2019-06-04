const koa = require('./koa')
const test = require('./test').router

koa.enableRouter(test.routes(), test.allowedMethods())

koa.enableRouter()
