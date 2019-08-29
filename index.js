const koa = require('./src/koa')
const { router, register, methods } = require('./src/common')
const login = require('./src/login')
const circle = require('./src/circle')
const resource = require('./src/resource')
const schedule = require('./src/schedule')

register('/login', [methods.POST], login.login, { ignoreLogin: true })
register('/get_auth_code', [methods.POST], login.get_auth_code, { ignoreLogin: true })
register('/circle', [methods.POST, methods.PUT, methods.DELETE, methods.GET], circle.circle)
register('/circle_join', [methods.POST], circle.circle_join)
register('/circle_quit', [methods.POST], circle.circle_quit)
register('/circle_List', [methods.GET], circle.circle_list)
register('/resource', [methods.POST, methods.PUT, methods.DELETE, methods.GET], resource.resource)
register('/resource_list', [methods.POST], resource.resource_list)
register('/resource_list_with_myself', [methods.GET], resource.resource_list_with_myself)
register('/resource_list_with_collect', [methods.GET], resource.resource_list_with_collect)
register('/circle_with_user_join', [methods.GET], resource.circle_with_user_join)
register('/resource_collect', [methods.POST], resource.resource_collect)
register('/upload_img', [methods.POST], resource.upload_img)

koa.router.use(router.routes(), router.allowedMethods())

koa.enableRouter()


schedule.myEmitter.emit('start_schedule')
