const ajv = require('ajv')({ useDefaults: true })
const squel = require('squel')
const uuidV4 = require('uuid/v4')
const uuidV1 = require('uuid/v1')
const moment = require('moment')

const common = require('../common')

const schemaCircle_create = {
	properties: {
		circleName: { type: 'string' },
	},
	required: ['circleName'],
}

const schemaCirclePut = {
	properties: {
		qqqun: { type: 'string' },
		notice: { type: 'string' },
		remark: { type: 'string' },
		circleId: { type: 'string' },
	},
	required: ['circleId'],
}

const schemaCircleDelete = {
	properties: {
		circleId: { type: 'string' },
	},
	required: ['circleId'],
}

async function circle(ctx) {
	const { method } = ctx.request

	console.log('method', method)

	if (method === 'GET') {
		console.log('1111')
	} else if (method === 'POST') {
		const data = ctx.request.body

		const valid = ajv.compile(schemaCircle_create)

		if (!valid(data)) {
			ctx.status = 400
			ctx.body = '参数错误'
			return
		}

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const circleList = await common.pool.queryAsync(squel.select().from('circle').where('user_id = ?', userId).toString())

		if (circleList.length >= 3) {
			ctx.status = 400
			ctx.body = '您创建的圈子已超过最大限制'
			return
		}

		const circleNumber = uuidV1(null, Array.from(10), 0).join('')

		const circleId = uuidV4().replace(/-/g, '')

		await common.pool.queryAsync(squel.insert().into('circle').setFields({
			id: circleId,
			circle_name: data.circleName,
			circle_number: circleNumber.substring(circleNumber.length - 11),
			user_id: userId,
			create_time: moment().unix(),
		}).toString())

		await common.pool.queryAsync(squel.insert().into('circle_user').setFields({
			circle_id: circleId,
			user_id: userId,
			is_owner: 1,
			create_time: moment().unix(),
		}).toString())

		ctx.status = 200
		ctx.body = 'success'
	} else if (method === 'PUT') {
		// const data = ctx.request.body
		console.log('111')
		const data = ctx.request.body

		const valid = ajv.compile(schemaCirclePut)

		if (!valid(data)) {
			ctx.status = 400
			ctx.body = '参数错误'
			return
		}

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const user_has_circle = await common.pool.queryAsync(squel.select().from('circle').where('user_id = ?', userId).where('id = ?', data.circleId)
			.toString())[0]

		if (!user_has_circle) {
			ctx.status = 400
			ctx.body = '您不是圈主,无权限修改'
			return
		}

		const sqlStr = squel.update().table('circle').where('id = ?', data.circleId)

		if (typeof data.qqqun !== 'undefined') {
			sqlStr.set('qq_qun', data.qqqun)
		}
		if (typeof data.notice !== 'undefined') {
			sqlStr.set('notice', data.notice)
		}
		if (typeof data.remark !== 'undefined') {
			sqlStr.set('remark', data.remark)
		}

		await common.pool.queryAsync(sqlStr.toString())

		ctx.status = 200
		ctx.body = 'success'
	} else if (method === 'DELETE') {
		console.log('2222')

		const data = ctx.request.body

		const valid = ajv.compile(schemaCircleDelete)

		if (!valid(data)) {
			ctx.status = 400
			ctx.body = '参数错误'
			return
		}

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const user_has_circle = await common.pool.queryAsync(squel.select().from('circle').where('user_id = ?', userId).where('id = ?', data.circleId)
			.toString())[0]

		if (!user_has_circle) {
			ctx.status = 400
			ctx.body = '您不是圈主,无权限删除'
			return
		}

		let connon

		try {
			connon = common.pool.getConnectionAsync()

			await connon.beginTransactionAsync()

			await common.pool.queryAsync(squel.delete().from('circle').where('id = ?', data.circleId).toString())
			await common.pool.queryAsync(squel.delete().from('circle_user').where('circle_id = ?', data.circleId).toString())
		} catch (e) {
			if (connon) {
				await connon.rollbackAsync()
			}
		} finally {
			if (connon) {
				connon.release()
			}
		}
		ctx.status = 200
		ctx.body = 'success'
	}
}

const schemaCircleJoin = {
	properties: {
		circleId: { type: 'string' },
	},
	required: ['circleId'],
}

async function circle_join(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaCircleJoin)

	if (!valid(data)) {
		ctx.status = 400
		ctx.body = '参数错误'
		return
	}

	console.log('11')

	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	const userHasKickout = (await common.pool.queryAsync(squel.select().from('circle_user').where('user_id = ?', userId).where('circle_id = ?', data.circleId)
		.toString()))[0]

	if (userHasKickout) {
		if (userHasKickout.is_kick_out) {
			ctx.status = 400
			ctx.body = '您已经被该圈主删除，不可进入'
			return
		}
		ctx.status = 400
		ctx.body = '您已加过该圈子，不可重复进入'
		return
	}

	const userHasCircles = await common.pool.queryAsync(squel.select().from('circle_user').where('user_id = ?', userId).where('is_owner = ?', 0)
		.toString())

	if (userHasCircles.length >= 10) {
		ctx.status = 400
		ctx.body = '您加入的圈子数量已超过最大限制'
		return
	}

	await common.pool.queryAsync(squel.insert().into('circle_user').setFields({
		circle_id: data.circleId,
		user_id: userId,
		create_time: moment().unix(),
	}).toString())

	ctx.status = 200
	ctx.body = 'success'
}

const schemaCircleQuit = {
	properties: {
		circleId: { type: 'string' },
		quitUserId: { type: 'string' },
	},
	required: ['circleId', 'quitUserId'],
}

async function circle_quit(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaCircleQuit)

	if (!valid(data)) {
		ctx.status = 400
		ctx.body = '参数错误'
		return
	}

	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	if (userId === data.quitUserId) {
		await common.pool.queryAsync(squel.delete().from('circle_user').where('user_id = ?', data.quitUserId))
	} else {
		await common.pool.queryAsync(squel.update().table('circle_user').set('is_kick_out', 1).where('user_id = ?', data.quitUserId))
	}

	ctx.status = 200
	ctx.body = 'success'
}

module.exports = {
	circle, circle_join, circle_quit,
}
