const koa = require('./src/koa')
const { router, register, methods } = require('./src/common')
const login = require('./src/login')
const circle = require('./src/circle')
const resource = require('./src/resource')

register('/login', [methods.POST], login.login, { ignoreLogin: true })
register('/get_auth_code', [methods.POST], login.get_auth_code, { ignoreLogin: true })
register('/circle', [methods.POST, methods.PUT, methods.DELETE, methods.GET], circle.circle)
register('/circle_join', [methods.POST], circle.circle_join)
register('/circle_quit', [methods.POST], circle.circle_quit)
register('/resource', [methods.POST, methods.PUT, methods.DELETE, methods.GET], resource.resource)
register('/resource_list', [methods.POST], resource.resource_list)
register('/resource_list', [methods.GET], resource.circle_with_user_join)

koa.router.use(router.routes(), router.allowedMethods())

koa.enableRouter()
