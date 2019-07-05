const koa = require('./src/koa')
const { router, register, methods } = require('./src/common')
const login = require('./src/login')
const circle = require('./src/circle')
const resource = require('./src/resource')

register('/login', [methods.POST], login.login, { ignoreLogin: true })
register('/get_auth_code', [methods.POST], login.get_auth_code, { ignoreLogin: true })
register('/circle', [methods.POST, methods.PUT, methods.DELETE, methods.GET], circle.circle)
register('/circle_join', [methods.POST], circle.circle_join)
register('/resource', [methods.POST, methods.PUT, methods.DELETE, methods.GET], resource.resource, { ignoreLogin: true })

koa.router.use(router.routes(), router.allowedMethods())

koa.enableRouter()
