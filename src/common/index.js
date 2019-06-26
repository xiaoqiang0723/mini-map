
const { router, app } = require('../koa')

const methods = {
	GET: 'get',
	POST: 'post',
	PUT: 'put',
	DELETE: 'delete',
}

async function checkoutSession(ctx, next) {
	console.log('11111111111')
	await next()
}

function register(path, requestMethod, method, option) {
	const { ignoreLogin } = option
	if (!ignoreLogin) {
		app.use(checkoutSession)
	}
	router.register(path, requestMethod, method)
}
module.exports = {
	register, methods, router,
}
