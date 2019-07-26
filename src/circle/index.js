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

const schemaCircleGet = {
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

		const data = ctx.query

		const valid = ajv.compile(schemaCircleGet)

		if (!valid(data)) {
			ctx.body = {
				status: 400,
				message: '参数错误',
				data: {},
			}
			return
		}

		const circleWithId = (await common.pool.queryAsync(squel.select().from('circle').where('id = ?', data.circleId)))[0]

		ctx.body = {
			status: 200,
			message: 'success',
			data: circleWithId || {},
		}
	} else if (method === 'POST') {
		const data = ctx.request.body

		const valid = ajv.compile(schemaCircle_create)

		if (!valid(data)) {
			ctx.body = {
				status: 400,
				message: '参数错误',
				data: {},
			}
			return
		}

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const circleList = await common.pool.queryAsync(squel.select().from('circle').where('user_id = ?', userId).toString())

		if (circleList.length >= 3) {
			ctx.body = {
				status: 400,
				message: '您创建的圈子已超过最大限制',
				data: {},
			}
			return
		}

		const circleNumber = uuidV1(null, Array.from(10), 0).join('')

		const circleId = uuidV4().replace(/-/g, '')

		const userHasCircles = await common.pool.queryAsync(squel.select().from('circle_user').where('user_id = ?', userId).toString())
		console.log('userHasCircles', userHasCircles)

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

		if (!userHasCircles || userHasCircles.length === 0) {
			console.log('11111111111111')
			await common.redisClient.setAsync(`${userId}_last_join_circle`, `${circleId}`)
		}

		ctx.body = {
			status: 200,
			message: 'success',
			data: {
				circleId,
			},
		}
	} else if (method === 'PUT') {
		// const data = ctx.request.body
		console.log('111')
		const data = ctx.request.body

		const valid = ajv.compile(schemaCirclePut)

		if (!valid(data)) {
			ctx.body = {
				status: 400,
				message: '参数错误',
				data: {},
			}
			return
		}

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const user_has_circle = await common.pool.queryAsync(squel.select().from('circle').where('user_id = ?', userId).where('id = ?', data.circleId)
			.toString())[0]

		if (!user_has_circle) {
			ctx.body = {
				status: 400,
				message: '您不是圈主,无权限修改',
				data: {},
			}
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

		ctx.body = {
			status: 200,
			message: 'success',
			data: {},
		}
	} else if (method === 'DELETE') {
		console.log('2222')

		const data = ctx.request.body

		const valid = ajv.compile(schemaCircleDelete)

		if (!valid(data)) {
			ctx.body = {
				status: 400,
				message: '参数错误',
				data: {},
			}
			return
		}

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const user_has_circle = await common.pool.queryAsync(squel.select().from('circle').where('user_id = ?', userId).where('id = ?', data.circleId)
			.toString())[0]

		if (!user_has_circle) {
			ctx.body = {
				status: 400,
				message: '您不是圈主,无权限删除',
				data: {},
			}
			return
		}

		let connon

		try {
			connon = common.pool.getConnectionAsync()

			await connon.beginTransactionAsync()

			await connon.queryAsync(squel.delete().from('circle').where('id = ?', data.circleId).toString())
			await connon.queryAsync(squel.delete().from('circle_user').where('circle_id = ?', data.circleId).toString())

			await connon.commitAsync()
		} catch (e) {
			if (connon) {
				await connon.rollbackAsync()
			}
		} finally {
			if (connon) {
				connon.release()
			}
		}

		ctx.body = {
			status: 200,
			message: 'success',
			data: {},
		}
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
		ctx.body = {
			status: 400,
			message: '参数错误',
			data: {},
		}
		return
	}

	console.log('11')

	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	const userHasKickout = (await common.pool.queryAsync(squel.select().from('circle_user').where('user_id = ?', userId).where('circle_id = ?', data.circleId)
		.toString()))[0]

	if (userHasKickout) {
		if (userHasKickout.is_kick_out) {
			ctx.body = {
				status: 400,
				message: '您已经被该圈主删除，不可进入',
				data: {},
			}
			return
		}
		ctx.body = {
			status: 400,
			message: '您已加过该圈子，不可重复进入',
			data: {},
		}
		return
	}

	const userHasCircles = await common.pool.queryAsync(squel.select().from('circle_user').where('user_id = ?', userId).where('is_owner = ?', 0)
		.toString())

	if (userHasCircles.length >= 10) {
		ctx.body = {
			status: 400,
			message: '您加入的圈子数量已超过最大限制',
			data: {},
		}
		return
	}

	await common.pool.queryAsync(squel.insert().into('circle_user').setFields({
		circle_id: data.circleId,
		user_id: userId,
		create_time: moment().unix(),
	}).toString())

	ctx.body = {
		status: 200,
		message: 'success',
		data: {},
	}
}

const schemaCircleQuit = {
	properties: {
		circleId: { type: 'string' },
		quitUserId: { type: 'string' },
	},
	required: ['circleId'],
}

async function circle_quit(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaCircleQuit)

	if (!valid(data)) {
		ctx.body = {
			status: 400,
			message: '参数错误',
			data: {},
		}
		return
	}

	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	if (data.quitUserId) {
		const userIsCircler = (await common.pool.queryAsync(squel.select().from('circle_user').where('circle_id = ?', data.circleId).where('user_id = ?', userId)
			.where('is_owner = ?', 1)
			.toString()))[0]

		if (!userIsCircler) {
			ctx.body = {
				status: 400,
				message: '您没有删除圈子成员的权限',
				data: {},
			}
			return
		}
		await common.pool.queryAsync(squel.update().table('circle_user').set('is_kick_out', 1).where('user_id = ?', data.quitUserId))
	}

	await common.pool.queryAsync(squel.delete().from('circle_user').where('user_id = ?', userId))

	ctx.body = {
		status: 200,
		message: 'success',
		data: {},
	}
}

async function circle_list(ctx) {
	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	const circleWithUserJoin = await common.pool.queryAsync(squel.select().from('circle', 'a').join('circle_user', 'b', 'a.id = b.circle_id').field('a.*')
		.where('b.user_id = ?', userId)
		.where('is_owner = ?', 0)
		.where('is_kick_out = ?', 0)
		.toString())
	const circleWithUserCreate = await common.pool.queryAsync(squel.select().from('circle', 'a').join('circle_user', 'b', 'a.id = b.circle_id').field('a.*')
		.where('b.user_id = ?', userId)
		.where('is_owner = ?', 1)
		.toString())
	const circleWithUserCollect = await common.pool.query(squel.select().from('resource', 'a').join('user_collect', 'b', 'a.id = b.resource_id').toString())

	ctx.body = {
		status: 200,
		message: 'success',
		data: {
			circleWithUserJoin,
			circleWithUserCreate,
			circleWithUserCollect,
		},
	}
}

module.exports = {
	circle, circle_join, circle_quit, circle_list,
}
