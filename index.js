const koa = require('./src/koa')
const { router, register, methods } = require('./src/common')
const login = require('./src/login')

register('/login', [methods.POST], login.login, { ignoreLogin: true })

koa.router.use(router.routes(), router.allowedMethods())

koa.enableRouter()
