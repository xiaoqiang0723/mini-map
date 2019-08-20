
const crypto = require('crypto')
const redis = require('redis')
const bluebird = require('bluebird')
const mysql = require('mysql')
const Connection = require('mysql/lib/Connection')
const _ = require('lodash')

const { router } = require('../koa')
const config = require('../../config')

const redisClient = redis.createClient(config.redis)
bluebird.promisifyAll(redisClient)

const pool = mysql.createPool(_.extend(config.mysql, { multipleStatements: true, charset: 'UTF8MB4_BIN' }))
bluebird.promisifyAll(pool)
bluebird.promisifyAll(Connection.prototype)

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

async function getUserId(sessionid) {
	const userDataStr = await redisClient.getAsync(sessionid)
	return JSON.parse(userDataStr).openId
}

async function refreshSession(sessionid) {
	await redisClient.expireAsync(sessionid, 60 * 60 * 2)
}

async function checkoutSession(ctx, next) {
	const { sessionid } = ctx.request.header || ''

	ctx.status = 200

	const has_key = await redisClient.existsAsync(sessionid)

	if (!has_key) {
		ctx.body = {
			status: 201,
			message: '登录过期',
			data: { },
		}
		return
	}

	await refreshSession(sessionid)

	try {
		console.log(`[mini-map request parameter ] ${ctx.request.ip} ${ctx.request.path} ${ctx.request.method} %j`, ctx.request.method === 'GET' ? JSON.stringify(ctx.query) : JSON.stringify(ctx.request.body))
		console.log('1111111111111111')
		await next()
	} catch (e) {
		console.log('err', e.stack)
		ctx.body = {
			status: 500,
			message: '系统繁忙，请稍后再试',
			data: {},
		}
	} finally {
		console.log('[Parking-terminal Http Server Send] %j', JSON.stringify(ctx.body))
	}
}

function register(path, requestMethod, method, option = {}) {
	const { ignoreLogin } = option
	// if (!ignoreLogin) {
	// 	app.use(checkoutSession)
	// }
	if (!ignoreLogin) {
		router.register(path, requestMethod, checkoutSession, method)
	}
	router.register(path, requestMethod, method)
}

module.exports = {
	register, methods, router, getSessionId, redisClient, refreshSession, pool, getUserId,
}
