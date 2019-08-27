const ajv = require('ajv')({ useDefaults: true })
const squel = require('squel')
const uuidV4 = require('uuid/v4')
const uuidV1 = require('uuid/v1')
const moment = require('moment')
const OSS = require('ali-oss')
const _ = require('lodash')
const request = require('request-promise')

const config = require('../../config')

const common = require('../common')

const client = new OSS({
	region: 'oss-cn-zhangjiakou',
	accessKeyId: config.ali.msg_accesskey_id,
	accessKeySecret: config.ali.msg_accesskey_secret,
	bucket: 'mini-map',
})


const getQRCodeOption = {
	uri: config.wx.qr_code_url,
	method: 'POST',
	qs: {
		access_token: '',
	},
	body: {
		scene: '',
		page: '',
	},
	json: true,
}

async function putBuffer(fileBuffer) {
	let result
	try {
		result = await client.put(`imgs/${uuidV4().replace(/-/g, '')}.jpeg`, fileBuffer)
		console.log(result)
	} catch (e) {
		console.log(e)
	}

	return result
}

async function deleteMulti(fileNames) {
	const clientCopy = _.cloneDeep(client)
	const result = await clientCopy.deleteMulti(fileNames, { quite: true })

	console.log('result', result)

	return result
}

const schemaCircle_create = {
	properties: {
		circleName: { type: 'string' },
		imgId: { type: 'string' },
	},
	required: ['circleName', 'imgId'],
}

const schemaCirclePut = {
	properties: {
		qqqun: { type: 'string' },
		notice: { type: 'string' },
		remark: { type: 'string' },
		circleId: { type: 'string' },
		imgId: { type: 'string' },
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

		const circleWithId = (await common.pool.queryAsync(squel.select().from('circle').where('id = ?', data.circleId).toString()))[0]

		const userListOfCircle = await common.pool.queryAsync(squel.select().from('circle_user', 'a').join('user', 'b', 'a.user_id = b.id').where('a.circle_id = ?', data.circleId)
			.where('is_kick_out = ?', 0)
			.field('a.user_id')
			.field('b.nick_name')
			.field('b.avatar_url')
			.toString())

		circleWithId.userList = userListOfCircle || []
		circleWithId.member_count = circleWithId.userList.length || 0

		const refreshCount = await common.redisClient.getAsync(`${data.circleId}_reflush`)

		circleWithId.refresh_count = refreshCount || 0

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

		if (circleList.length >= config.limit.createCircleCount) {
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

		const img = (await common.pool.queryAsync(squel.select().from('resource_pic').where('id = ?', data.imgId).toString()))[0]

		// 生成二维码
		let qrCodeUrl = ''
		const accessToken = await common.redisClient.getAsync('wx_access_token') || ''
		const getQRCodeOptionCopy = _.cloneDeep(getQRCodeOption)
		getQRCodeOptionCopy.qs.access_token = accessToken
		getQRCodeOptionCopy.body.scene = `circleId=${circleId}`
		getQRCodeOptionCopy.body.page = 'pages/share/share'

		const bufferResult = await request(getQRCodeOptionCopy)

		console.log('bufferResult', bufferResult)

		if (bufferResult.errcode === 0 && bufferResult.errmsg === 'ok') {
			const resultWithPushImg = await putBuffer(bufferResult.buffer)

			if (resultWithPushImg) {
				qrCodeUrl = resultWithPushImg.url

				const id = uuidV4().replace(/-/g, '')
				await common.pool.queryAsync(squel.insert().into('resource_pic').setFields({
					id,
					resource_id: circleId,
					pic_name: resultWithPushImg.name,
					pic_url: resultWithPushImg.url,
					create_time: moment().unix(),
				}).toString())
			}
		}

		await common.pool.queryAsync(squel.insert().into('circle').setFields({
			id: circleId,
			circle_name: data.circleName,
			circle_number: circleNumber.substring(circleNumber.length - 11),
			head_url: img ? img.pic_url || '' : '',
			circle_qr_code: qrCodeUrl,
			user_id: userId,
			create_time: moment().unix(),
		}).toString())

		await common.pool.queryAsync(squel.update().table('resource_pic').set('resource_id', data.circleId).where('id = ?', data.imgId)
			.toString())

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

		const user_has_circle = (await common.pool.queryAsync(squel.select().from('circle').where('user_id = ?', userId).where('id = ?', data.circleId)
			.toString()))[0]

		if (!user_has_circle) {
			ctx.body = {
				status: 400,
				message: '您不是圈主,无权限修改',
				data: {},
			}
			return
		}

		let connon

		try {
			connon = await common.pool.getConnectionAsync()

			await connon.beginTransactionAsync()

			let img

			if (data.imgId) {
				[img] = await connon.queryAsync(squel.select().from('resource_pic').where('id = ?', data.imgId).toString())

				if (img && img.pic_url !== user_has_circle.head_url) {
					await connon.queryAsync(squel.update().table('resource_pic').set('resource_id', data.circleId).where('id = ?', data.imgId)
						.toString())
					const deleteImg = (await connon.queryAsync(squel.select().from('resource_pic').where('pic_url = ?', user_has_circle.head_url).toString()))[0]
					if (deleteImg) {
						await deleteMulti([deleteImg.pic_name])
					}
				}
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
			if (img && img.pic_url !== user_has_circle.head_url) {
				sqlStr.set('head_url', img.pic_url)
			}

			await connon.queryAsync(sqlStr.toString())

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

		const user_has_circle = (await common.pool.queryAsync(squel.select().from('circle').where('user_id = ?', userId).where('id = ?', data.circleId)
			.toString()))[0]

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
			connon = await common.pool.getConnectionAsync()

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

		const lastJoinCircleId = await common.redisClient.getAsync(`${userId}_last_join_circle`)
		if (lastJoinCircleId === data.circleId) {
			await common.redisClient.delAsync(`${userId}_last_join_circle`)
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
				message: '您已经被该圈主踢出，不可进入',
				data: {},
			}
			return
		}
		ctx.body = {
			status: 205,	// 唯一状态码，代表已经加过圈子
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

	const userIsCircler = (await common.pool.queryAsync(squel.select().from('circle_user').where('circle_id = ?', data.circleId).where('user_id = ?', userId)
		.where('is_owner = ?', 1)
		.toString()))[0]

	if (data.quitUserId) {
		if (!userIsCircler) {
			ctx.body = {
				status: 400,
				message: '您没有删除圈子成员的权限',
				data: {},
			}
			return
		}
		await common.pool.queryAsync(squel.update().table('circle_user').set('is_kick_out', 1).where('user_id = ?', data.quitUserId)
			.toString())
	} else if (userIsCircler) { // 圈主解散圈子
		let connon
		try {
			connon = await common.pool.getConnectionAsync()
			await connon.beginTransactionAsync()

			const deleteImgs = await connon.queryAsync(squel.select().from('resource_pic').where('resource_id = ?', data.circleId).toString())

			if (deleteImgs.length > 0) {
				await deleteMulti(_.map(deleteImgs, v => v.pic_name))
			}

			await connon.queryAsync(squel.delete().from('resource_pic').where('resource_id = ?', data.circleId).toString())

			const resourceListWithCircle = await connon.queryAsync(squel.select().from('resource').where('circle_id = ?', data.circleId).toString())

			await connon.queryAsync(squel.delete().from('user_collect').where('resource_id = ?', _.map(resourceListWithCircle, v => v.id).toString()))

			await connon.queryAsync(squel.delete().from('resource').where('circle_id = ?', data.circleId).toString())

			await connon.queryAsync(squel.delete().from('circle_user').where('circle_id = ?', data.circleId)
				.toString())

			await connon.queryAsync(squel.delete().from('circle').where('id = ?', data.circleId).toString())

			await connon.commitAsync()
		} catch (e) {
			console.log('e', e.stack)
			if (connon) {
				await connon.rollbackAsync()
			}
		} finally {
			if (connon) {
				connon.release()
			}
		}
	} else {	// 圈成员退出圈子
		await common.pool.queryAsync(squel.delete().from('circle_user').where('user_id = ?', userId).where('circle_id = ?', data.circleId)
			.toString())
	}


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
	const circleWithUserCollect = await common.pool.queryAsync(squel.select().from('resource', 'a').join('user_collect', 'b', 'a.id = b.resource_id').where('b.user_id = ?', userId)
		.toString())

	// const memberCountList = await common.pool.queryAsync(squel.select().from('circle_user').field('count(*)').where('circle_id in ?' ))

	const circleListWithUser = _.concat(circleWithUserCreate, circleWithUserJoin)

	const flushCirlceWithUser = _.map(circleListWithUser, async v => ({
		id: v.id,
		refresh_count: await common.redisClient.getAsync(`${v.id}_reflush`) || 0,
	}))

	const flushCirlceWithUserList = await Promise.all(flushCirlceWithUser)

	console.log('flushCirlceWithUserList', flushCirlceWithUserList)

	_.forEach(circleWithUserCreate, (v) => {
		v.refresh_count = _.find(flushCirlceWithUserList, { id: v.id }).refresh_count
	})

	_.forEach(circleWithUserJoin, (v) => {
		v.refresh_count = _.find(flushCirlceWithUserList, { id: v.id }).refresh_count
	})

	if (circleListWithUser.length > 0) {
		const menberCountListWithUser = await common.pool.queryAsync(squel.select().from('circle_user').field('circle_id').field('count(*) as \'member_count\'')
			.where('circle_id in ?', _.map(circleListWithUser, v => v.id))
			.group('circle_id')
			.toString())

		_.forEach(circleWithUserCreate, (v) => {
			v.member_count = _.find(menberCountListWithUser, { circle_id: v.id }) ? _.find(menberCountListWithUser, { circle_id: v.id }).member_count : 0
		})

		_.forEach(circleWithUserJoin, (v) => {
			v.member_count = _.find(menberCountListWithUser, { id: v.id }) ? _.find(menberCountListWithUser, { id: v.id }).member_count : 0
		})
	}

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
