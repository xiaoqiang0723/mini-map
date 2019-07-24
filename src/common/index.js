
const crypto = require('crypto')
const redis = require('redis')
const bluebird = require('bluebird')
const mysql = require('mysql')
const _ = require('lodash')

const { router } = require('../koa')
const config = require('../../config')

const redisClient = redis.createClient(config.redis)
bluebird.promisifyAll(redisClient)

const pool = mysql.createPool(_.extend(config.mysql, { multipleStatements: true }))
bluebird.promisifyAll(pool)

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
	const { sessionid } = ctx.request.header

	const has_key = await redisClient.existsAsync(sessionid)

	if (!has_key) {
		ctx.status = 201
		ctx.body = '登录过期'
		return
	}

	await refreshSession(sessionid)

	try {
		ctx.status = 200
		await next()
	} catch (e) {
		ctx.status = 500
		ctx.body = '系统繁忙，请稍后再试'
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
