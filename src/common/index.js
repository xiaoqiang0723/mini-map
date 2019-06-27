
const crypto = require('crypto')
const redis = require('redis')
const bluebird = require('bluebird')

const { router, app } = require('../koa')
const config = require('../../config')

const redisClient = redis.createClient(config.redis)
bluebird.promisifyAll(redisClient)

redisClient.on('error', (e) => {
	console.error('[Parking-terminal New-Protocol redis error]', e)
})

const methods = {
	GET: 'get',
	POST: 'post',
	PUT: 'put',
	DELETE: 'delete',
}

function getSessionId(openId) {
	const hash = crypto.createHash('md5')
	return hash.update(openId).digest('base64')
}

async function refreshSession(sessionid) {
	await redisClient.expireAsync(sessionid, 60 * 60 * 2)
}

async function checkoutSession(ctx, next) {
	const { sessionid } = ctx.request.header
	const userStr = await redisClient.getAsync(sessionid)
	if (!userStr) {
		ctx.status = 201
		ctx.body = '登录过期'
		return
	}
	await refreshSession(sessionid)

	await next()
}

function register(path, requestMethod, method, option = {}) {
	const { ignoreLogin } = option
	if (!ignoreLogin) {
		app.use(checkoutSession)
	}
	router.register(path, requestMethod, method)
}
module.exports = {
	register, methods, router, getSessionId, redisClient, refreshSession,
}
