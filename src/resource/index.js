const OSS = require('ali-oss')
const _ = require('lodash')
const fs = require('fs')
const uuid = require('uuid/v4')
const moment = require('moment')
const ajv = require('ajv')({ useDefaults: true })
const squel = require('squel')

const common = require('../common')
const config = require('../../config')

const schemaResource = {
	properties: {
		circleId: { type: 'string' },
		resrouceName: { type: 'string' },
		qqNumber: { type: 'string' },
		lat: { type: 'string' },
		lng: { type: 'string' },
		wxchat: { type: 'string' },
		fenshiqun: { type: 'string' },
		douyin: { type: 'string' },
		remark: { type: 'string' },
		address: { type: 'string' },
		addressName: { type: 'string' },
		imgIds: { type: 'array', items: { type: 'string' } },
	},
	required: ['circleId', 'resrouceName', 'lat', 'lng'],
}

const schemaResourceGet = {
	properties: {
		resourceId: { type: 'string', minLength: 1 },
		from: { type: 'number' },
	},
	required: ['resourceId'],
}

const schemaResourcePut = {
	properties: {
		resourceId: { type: 'string' },
		resourceName: { type: 'string' },
		qqNumber: { type: 'string' },
		wxchat: { type: 'string' },
		fenshiqun: { type: 'string' },
		douyin: { type: 'string' },
		remark: { type: 'string' },
		imgIds: { type: 'array', items: { type: 'string' } },
	},
	required: ['resourceId'],
}

const schemaResourceDelete = {
	properties: {
		resourceId: { type: 'string' },
	},
	required: ['resourceId'],
}

const client = new OSS({
	region: 'oss-cn-zhangjiakou',
	accessKeyId: config.ali.msg_accesskey_id,
	accessKeySecret: config.ali.msg_accesskey_secret,
	bucket: 'mini-map',
})

async function putStream(file) {
	let result
	try {
		if (file) {
			result = await client.put(`imgs/${uuid().replace(/-/g, '')}${file.name.substring(file.name.lastIndexOf('.'))}`, fs.readFileSync(file.path), { contentLength: file.size })
		}
	} catch (e) {
		console.log('err', e)
	}

	return result
}

async function deleteMulti(fileNames) {
	const clientCopy = _.cloneDeep(client)
	const result = await clientCopy.deleteMulti(fileNames, { quite: true })

	console.log('result', result)

	return result
}

// async function reflushCount(circleId) {
// 	const reflushCountWithCircleId = await common.redisClient.getAsync(`${circleId}_reflush`)

// 	if (!reflushCountWithCircleId) {
// 		await common.redisClient.setAsync(`${circleId}_reflush`, '1')
// 		await common.redisClient.expireAsync(`${circleId}_reflush`, `${moment().endOf('day').unix() - moment(Date.now()).unix()}`)
// 		return
// 	}
// 	await common.redisClient.incrbyAsync(`${circleId}_reflush`, 1)
// }

async function upload_img(ctx) {
	const { files } = ctx.request

	const result = await putStream(files.file)

	let id = ''

	if (result) {
		id = uuid().replace(/-/g, '')
		await common.pool.queryAsync(squel.insert().into('resource_pic').setFields({
			id,
			resource_id: '',
			pic_name: result.name,
			pic_url: result.url,
			create_time: moment().unix(),
		}).toString())
	}

	ctx.body = {
		status: 200,
		message: 'success',
		data: {
			imgId: id,
		},
	}
}

function get_countdown(timestamp) {
	const hour = Math.floor(timestamp / (60 * 60))
	const mintu = Math.floor((timestamp - (hour * 60 * 60)) / 60)

	return `${hour < 10 ? `0${hour}` : hour}:${mintu < 10 ? `0${mintu}` : mintu}`
}

async function resource(ctx) {
	const { method } = ctx.request

	if (method === 'GET') {
		const data = ctx.query

		const valid = ajv.compile(schemaResourceGet)

		if (!valid(data)) {
			ctx.body = {
				status: 400,
				message: '参数错误',
				data: {},
			}
			return
		}

		console.log('data', data)

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const resourceWithId = (await common.pool.queryAsync(squel.select().from('resource').where('id = ?', data.resourceId).toString()))[0] || {}

		const resource_recommended_with_id = (await common.pool.queryAsync(squel.select().from('resource_recommended_log').where('resource_id = ?', data.resourceId)
			.where('recommended_type != ?', 2)
			.order('id', false)
			.toString()))[0]

		if (resource_recommended_with_id) {
			resourceWithId.is_recommended_user = userId === resource_recommended_with_id.recommended_user_id
			resourceWithId.recommended_countdown = get_countdown(moment(resource_recommended_with_id.create_time * 1000).add(1, 'day').unix() - moment().unix())
			resourceWithId.is_over = resource_recommended_with_id.recommended_type === 1
		}

		if (resourceWithId.recommended_user_id) {
			const recommended_user = (await common.pool.queryAsync(squel.select().from('user').where('id = ?', resourceWithId.recommended_user_id).toString()))[0]

			resourceWithId.recommended_user_name = recommended_user.nick_name
		}

		const imgs = await common.pool.queryAsync(squel.select().from('resource_pic').field('id').field('pic_url')
			.where('resource_id = ?', data.resourceId)
			.toString()) || []

		resourceWithId.imgs = imgs

		ctx.body = {
			status: 200,
			message: 'success',
			data: { ...resourceWithId, create_time_str: moment(resourceWithId.create_time * 1000).format('YYYY-MM-DD') },
		}
	} else if (method === 'POST') {
		const data = ctx.request.body

		// const { files } = ctx.request

		// console.log('files', files)
		const valid = ajv.compile(schemaResource)

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

		const delete_resource_today = await common.redisClient.getAsync(`${userId}_resource_create`)

		if (delete_resource_today) {
			const user = (await common.pool.queryAsync(squel.select().from('user').where('id = ?', userId).toString()))[0]

			if (user.integral < 200) {
				ctx.body = {
					status: 400,
					message: '创建资源所需积分不足!',
					data: {},
				}
				return
			}
			await common.pool.queryAsync(squel.update().table('user').set('integral = integral - 200').where('id = ?', userId)
				.toString())
		}

		// const resourcesWithToday = _.filter(resources, v => v.create_time > moment().startOf('day').unix())

		// if (resourcesWithToday.length >= config.limit.addResourceWithDay) {
		// 	ctx.body = {
		// 		status: 400,
		// 		message: '该圈子今天添加的资源数已超过限制，请改天再试试吧',
		// 		data: {},
		// 	}
		// 	return
		// }

		console.log('data', data)


		const resourceId = uuid().replace(/-/g, '')

		const sql = squel.insert().into('resource').set('id', resourceId).set('user_id', userId)
			.set('circle_id', data.circleId)
			.set('lat', data.lat)
			.set('lng', data.lng)
			.set('resource_name', data.resrouceName)
			.set('create_time', moment().unix())
			.set('update_time', moment().unix())

		if (data.qqNumber) {
			sql.set('qq_number', data.qqNumber)
		}
		if (data.wxchat) {
			sql.set('wxchat', data.wxchat)
		}
		if (data.fenshiqun) {
			sql.set('fenshi_qun', data.fenshiqun)
		}
		if (data.douyin) {
			sql.set('douyin', data.douyin)
		}
		if (data.remark) {
			sql.set('remark', data.remark)
		}
		if (data.address) {
			sql.set('address', data.address)
		}
		if (data.addressName) {
			sql.set('address_name', data.addressName)
		}

		await common.pool.queryAsync(sql.toString())

		if (data.imgIds && data.imgIds.length > 0) {
			await common.pool.queryAsync(squel.update().table('resource_pic').set('resource_id', resourceId).where('id in ?', data.imgIds)
				.toString())
		}

		if (!delete_resource_today) {
			await common.pool.queryAsync(squel.update().table('user').set('integral = integral + 100').where('id = ?', userId)
				.toString())
		}

		// await reflushCount(data.circleId)
		await common.redisClient.setAsync(`${userId}_resource_create`, 'true')
		await common.redisClient.expireAsync(`${userId}_resource_create`, (moment().endOf('day').unix() - moment().unix()))

		ctx.body = {
			status: 200,
			message: 'success',
			data: {},
		}
	} else if (method === 'PUT') {
		const data = ctx.request.body

		const valid = ajv.compile(schemaResourcePut)

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

		const resourceWithId = (await common.pool.queryAsync(squel.select().from('resource').field('user_id').where('id = ?', data.resourceId)
			.toString()))[0]

		if (!resourceWithId) {
			ctx.body = {
				status: 400,
				message: '该资源不存在',
				data: {},
			}
			return
		}

		const delete_resource_today = await common.redisClient.getAsync(`${userId}_resource_edit`)

		if ((delete_resource_today && !resourceWithId.recommended_user_id)) {
			const user = (await common.pool.queryAsync(squel.select().from('user').where('id = ?', userId).toString()))[0]

			if (user.integral < 200) {
				ctx.body = {
					status: 400,
					message: '编辑资源所需积分不足!',
					data: {},
				}
				return
			}
			await common.pool.queryAsync(squel.update().table('user').set('integral = integral - 200').where('id = ?', userId)
				.toString())
		}

		if (resourceWithId.recommended_user_id && (resourceWithId.recommended_user_id !== userId)) {
			ctx.body = {
				status: 400,
				message: '该资源为付费资源，只有推荐者才能修改!',
				data: {},
			}
			return
		}

		let connon

		try {
			connon = await common.pool.getConnectionAsync()

			await connon.beginTransactionAsync()

			if (data.imgIds && data.imgIds.length > 0) {
				const imgs = await connon.queryAsync(squel.select().from('resource_pic').where('resource_id = ?', data.resourceId).toString())

				const deleteImgs = _.differenceBy(imgs, _.map(data.imgIds, v => ({ id: v })), 'id')

				if (deleteImgs.length > 0) {
					await deleteMulti(_.map(deleteImgs, v => v.pic_name))
				}

				await connon.queryAsync(squel.update().table('resource_pic').set('resource_id', data.resourceId).where('id in ?', data.imgIds)
					.toString())
			}

			const sql = squel.update().table('resource').where('id = ?', data.resourceId).set('update_time', moment().unix())

			if (typeof data.resourceName !== 'undefined') {
				sql.set('resource_name', data.resourceName)
			}
			if (typeof data.qqNumber !== 'undefined') {
				sql.set('qq_number', data.qqNumber)
			}
			if (typeof data.wxchat !== 'undefined') {
				sql.set('wxchat', data.wxchat)
			}
			if (typeof data.fenshiqun !== 'undefined') {
				sql.set('fenshi_qun', data.fenshiqun)
			}
			if (typeof data.douyin !== 'undefined') {
				sql.set('douyin', data.douyin)
			}
			if (typeof data.remark !== 'undefined') {
				sql.set('remark', data.remark)
			}

			await connon.queryAsync(sql.toString())


			await connon.commitAsync()

			// await reflushCount(data.circleId)

			await common.redisClient.setAsync(`${userId}_resource_edit`, 'true')
			await common.redisClient.expireAsync(`${userId}_resource_edit`, (moment().endOf('day').unix() - moment().unix()))
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
		const data = ctx.request.body

		const valid = ajv.compile(schemaResourceDelete)

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

		const resourceWithId = (await common.pool.queryAsync(squel.select().from('resource').where('id = ?', data.resourceId).toString()))[0]

		if (!resourceWithId) {
			ctx.body = {
				status: 400,
				message: '该资源不存在!',
				data: {},
			}
			return
		}
		if (resourceWithId.recommended_user_id) {
			ctx.body = {
				status: 400,
				message: '该资源为付费资源，无法删除!',
				data: {},
			}
			return
		}
		const delete_resource_today = await common.redisClient.getAsync(`${userId}_resource_delete`)

		if (delete_resource_today) {
			const user = (await common.pool.queryAsync(squel.select().from('user').where('id = ?', userId).toString()))[0]

			if (user.integral < 200) {
				ctx.body = {
					status: 400,
					message: '删除资源所需积分不足!',
					data: {},
				}
				return
			}
			await common.pool.queryAsync(squel.update().table('user').set('integral = integral - 200').where('id = ?', userId)
				.toString())
		}
		if (userId !== resourceWithId.user_id) {
			const circle = (await common.pool.queryAsync(squel.select().from('circle').where('id = ?', resourceWithId.circle_id).toString()))[0]

			ctx.body = {
				status: 400,
				message: '',
				data: {},
			}

			if (!circle) {
				ctx.body.message = '该圈子已解散!'
				return
			}

			// if (userId !== circle.user_id) {
			// 	ctx.body.message = '您没有权限删除该资源!'
			// 	return
			// }
		}

		await common.pool.queryAsync(squel.delete().from('resource').where('id = ?', data.resourceId).toString())

		await common.redisClient.setAsync(`${userId}_resource_delete`, 'true')
		await common.redisClient.expireAsync(`${userId}_resource_delete`, (moment().endOf('day').unix() - moment().unix()))

		ctx.body = {
			status: 200,
			message: 'success',
			data: {},
		}
	}
}

const schemaResourceList = {
	properties: {
		circleId: { type: 'string' },
		lat: { type: 'string' },
		lng: { type: 'string' },
		isFlush: { type: 'number' },
		isFree: { type: 'number', default: 1 },
	},
	required: ['circleId', 'isFlush', 'isFree'],
}

async function resource_list(ctx) {
	const { method } = ctx.request

	if (method === 'POST') {
		const data = ctx.request.body

		const valid = ajv.compile(schemaResourceList)

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

		let returnList = []

		if (data.lng && data.lat) {
			let has_show_resourceList = []

			const sql = squel.select().from('resource').where('circle_id = ?', data.circleId).order('id', false)

			if (data.isFree) {
				sql.where('resource_type = ?', 0)
			} else {
				sql.where('resource_type = ?', 1)
			}

			returnList = await common.pool.queryAsync(sql.toString())

			if (!data.isFree) {
				let has_new_context = false
				let voucher
				const has_show_resourceStr = await common.redisClient.getAsync(`user_${data.circleId}_has_show`)

				if (has_show_resourceStr) {
					has_show_resourceList = JSON.parse(has_show_resourceStr)
				}

				const resourcesWithNear = _.differenceBy(_.filter(returnList, v => (Math.abs(Number(v.lat) - Number(data.lat)) <= 10) && (Math.abs(Number(v.lng) - Number(data.lng)) <= 10)), has_show_resourceList, 'id')

				if (resourcesWithNear.length >= 10) {
					returnList = _.sortBy(resourcesWithNear, () => (0.5 - Math.random())).slice(0, 10) || []
				} else {
					returnList = _.sortBy(_.differenceBy(returnList, has_show_resourceList, 'id'), () => (0.5 - Math.random())).slice(0, 10) || []
				}

				if (returnList.length > 0) {
					[voucher] = (await common.pool.queryAsync(squel.select().from('voucher').where('user_id = ?', userId).where('circle_id = ?', data.circleId)
						.where('voucher_status = ?', 0)
						.order('id', true)
						.limit(1)
						.toString()))
					if (!voucher) {
						ctx.body = {
							status: 400,
							message: '您的刷新券不足，请购买后重试',
							data: [],
						}

						return
					}
					has_new_context = true
				}

				if (returnList.length >= 0 && returnList.length < 10) {
					returnList = _.concat(_.sortBy(has_show_resourceList, () => (0.5 - Math.random())).slice(0, 10 - returnList.length), returnList)
				}

				if (has_new_context && voucher) {
					let connon

					try {
						connon = await common.pool.getConnectionAsync()

						await connon.beginTransactionAsync()

						const user_ids = _.map(returnList, 'user_id')

						const user_list = await connon.queryAsync(squel.select().from('user').where('id in ?', user_ids).toString())
						const circle_detail = (await connon.queryAsync(squel.select().from('circle').where('id = ?', data.circleId).toString()))[0]

						await connon.queryAsync(squel.update().table('user').set(`balance = balance + ${(voucher.voucher_money * 0.1).toFixed(2)}`)
							.where('id = ?', circle_detail.user_id)
							.toString())

						await Promise.all(_.map(user_list, v => connon.queryAsync(squel.update().table('user')
							.set(`balance = balance + ${((voucher.voucher_money * 0.8) / user_list.length).toFixed(2)}`)
							.set('integral = integral + 100')
							.where('id = ?', v.id)
							.toString())))

						await connon.queryAsync(squel.update().table('voucher').set('voucher_status', 1).set('use_time', moment().unix())
							.where('id = ?', voucher.id)
							.toString())

						await connon.queryAsync(squel.insert().into('integral_log').setFields({
							integral: 100,
							integral_channel: 4,
							create_time: moment().unix(),
						}).toString())

						await connon.commitAsync()

						// await reflushCount(data.circleId)
					} catch (e) {
						if (connon) {
							await connon.rollbackAsync()
						}
					} finally {
						if (connon) {
							connon.release()
						}
					}
				}
			}

			if (returnList.length > 0) {
				const imgs = await common.pool.queryAsync(squel.select().field('id').field('resource_id').field('pic_url')
					.from('resource_pic')
					.where('resource_id in ?', _.map(returnList, v => v.id))
					.toString())

				if (imgs.length > 0) {
					const imgObj = _.groupBy(imgs, 'resource_id')
					_.forEach(returnList, (v) => {
						if (imgObj[v.id]) {
							v.imgs = imgObj[v.id]
						}
					})
				}
			}

			if (!data.isFree) {
				await common.redisClient.setAsync(`user_${data.circleId}_has_show`, JSON.stringify(_.concat(has_show_resourceList, _.differenceBy(returnList, has_show_resourceList, 'id'))))
				await common.redisClient.expireAsync(`user_${data.circleId}_has_show`, 2 * 60 * 60)
			}

			await common.redisClient.delAsync(`${userId}_collect`)
			await common.redisClient.setAsync(`${userId}_last_join_circle`, `${data.circleId}`)
		} else {
			returnList = await common.pool.queryAsync(squel.select().from('resource').where('circle_id = ?', data.circleId)
				.where('resource_type = ?', 0)
				.order('id', false)
				.toString())

			if (returnList.length > 0) {
				const userList = await common.pool.queryAsync(squel.select().from('user')
					.where('id in ?', _.compact(_.concat(_.map(returnList, 'user_id'), _.map(returnList, 'recommended_user_id')))).toString())

				_.forEach(returnList, (v) => {
					const add_user = _.find(userList, { id: v.user_id }) || {}
					const recommended_user = _.find(userList, { id: v.recommended_user_id }) || {}

					v.add_user = add_user.nick_name || ''
					v.recommended_user = recommended_user.nick_name || ''
				})
			}
		}

		ctx.body = {
			status: 200,
			message: 'success',
			data: returnList,
		}

		return
	}

	ctx.status = 404
	ctx.body = 'NOT FOUND'
}

const schemaCircleWithUserJoin = {
	properties: {
		resourceUserId: { type: 'string' },
	},
	required: ['resourceUserId'],
}

async function circle_with_user_join(ctx) {
	const { method } = ctx.request

	if (method === 'GET') {
		const data = ctx.query

		const valid = ajv.compile(schemaCircleWithUserJoin)

		if (!valid(data)) {
			ctx.body = {
				status: 400,
				message: '参数错误',
				data: {},
			}
			return
		}

		const circlesWithResourceUser = await common.pool.queryAsync(squel.select().from('circle', 'a').join('circle_user', 'b', 'a.id = b.circle_id').field('a.*')
			.where('b.user_id = ?', data.resourceUserId)
			.where('b.is_owner = ?', 0)
			.where('b.is_kick_out = ?', 0)
			.toString())

		ctx.body = circlesWithResourceUser || []
		ctx.status = 200

		return
	}

	ctx.status = 404
	ctx.body = 'NOT FOUND'
}

const schemaCollect = {
	properties: {
		resourceId: { type: 'string' },
	},
	required: ['resourceId'],
}

async function resource_collect(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaCollect)

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

	const user_has_collect = await common.redisClient.getAsync(`${userId}_collect`)
	await common.redisClient.expireAsync(`${userId}_collect`, moment().endOf('day').unix() - moment(Date.now()).unix())

	if (user_has_collect) {
		ctx.body = {
			status: 400,
			message: '请刷新后再点击收藏',
			data: {},
		}
		return
	}

	const resourceCollectWithUser = (await common.pool.queryAsync(squel.select().from('user_collect').where('user_id = ?', userId).where('resource_id = ?', data.resourceId)
		.toString()))[0]

	if (resourceCollectWithUser) {
		ctx.body = {
			status: 400,
			message: '亲,你已经收藏过该资源了!',
			data: {},
		}
		return
	}

	await common.pool.queryAsync(squel.insert().into('user_collect').setFields({
		id: uuid().replace(/-/g, ''),
		resource_id: data.resourceId,
		user_id: userId,
		create_time: moment().unix(),
	}).toString())

	await common.redisClient.setAsync(`${userId}_collect`, 'true')

	ctx.body = {
		status: 200,
		message: 'success',
		data: {},
	}
}

async function resource_list_with_myself(ctx) {
	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	const resourceList = await common.pool.queryAsync(squel.select().from('resource').where('user_id = ?', userId).toString())

	if (resourceList.length > 0) {
		const imgs = await common.pool.queryAsync(squel.select().field('id').field('resource_id').field('pic_url')
			.from('resource_pic')
			.where('resource_id in ?', _.map(resourceList, v => v.id))
			.toString())

		if (imgs.length > 0) {
			const imgObj = _.groupBy(imgs, 'resource_id')
			_.forEach(resourceList, (v) => {
				if (imgObj[v.id]) {
					v.imgs = imgObj[v.id]
				}
			})
		}
	}

	ctx.body = {
		status: 200,
		message: 'success',
		data: resourceList || [],
	}
}

async function list_with_user_collect(ctx) {
	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	const circleWithUserCollect = await common.pool.queryAsync(squel.select().from('resource', 'a').join('user_collect', 'b', 'a.id = b.resource_id').field('a.*')
		.where('b.user_id = ?', userId)
		.toString())

	if (circleWithUserCollect.length > 0) {
		const imgs = await common.pool.queryAsync(squel.select().field('id').field('resource_id').field('pic_url')
			.from('resource_pic')
			.where('resource_id in ?', _.map(circleWithUserCollect, v => v.id))
			.toString())

		if (imgs.length > 0) {
			const imgObj = _.groupBy(imgs, 'resource_id')
			_.forEach(circleWithUserCollect, (v) => {
				if (imgObj[v.id]) {
					v.imgs = imgObj[v.id]
				}
			})
		}
	}

	ctx.body = {
		status: 200,
		message: 'success',
		data: circleWithUserCollect || [],
	}
}

const schemaResourceRecommended = {
	properties: {
		resourceId: { type: 'string', minLength: 1 },
	},
	required: ['resourceId'],
}

async function resource_recommended(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaResourceRecommended)

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

	const user = (await common.pool.queryAsync(squel.select().from('user').where('id = ?', userId).toString()))[0]

	if (!user) {
		ctx.body = {
			status: 400,
			message: '用户不存在!',
			data: {},
		}
		return
	}

	const resource_recommended_with_id = (await common.pool.queryAsync(squel.select().from('resource_recommended_log').where('resource_id = ?', data.resourceId)
		.where('recommended_type = ?', 0)
		.toString()))[0]

	if (resource_recommended_with_id) {
		ctx.body = {
			status: 400,
			message: '该资源已被推荐，请明天再试!',
			data: {},
		}
		return
	}

	if (user.balance >= 5) { // 用户余额大于推荐费用，直接减
		let connon

		try {
			connon = await common.pool.getConnectionAsync()

			await connon.beginTransactionAsync()

			await connon.queryAsync(squel.insert().into('resource_recommended_log').setFields({
				resource_id: data.resourceId,
				recommended_user_id: userId,
				create_time: moment().unix(),
			}).toString())

			await connon.queryAsync(squel.update().table('resource').set('resource_type', 1).set('recommended_user_id', userId)
				.where('id = ?', data.resourceId)
				.toString())

			await connon.queryAsync(squel.update().table('user').set('balance = balance -5').where('id = ?', userId)
				.toString())

			await connon.commitAsync()

			// await reflushCount(data.circleId)
		} catch (e) {
			if (connon) {
				await connon.rollbackAsync()
			}
		} finally {
			if (connon) {
				connon.release()
			}
		}
	} else { // 使用微信支付
		ctx.body = {
			status: 400,
			message: '余额不足，暂不支持微信支付',
			data: {},
		}

		return
	}

	ctx.body = {
		status: 200,
		message: 'success',
		data: {},
	}
}

const schemaResourceRecommendedRefund = {
	properties: {
		resourceId: { type: 'string', minLength: 1 },
	},
	required: ['resourceId'],
}

async function resource_recommended_refund(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaResourceRecommendedRefund)

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

	const user = (await common.pool.queryAsync(squel.select().from('user').where('id = ?', userId).toString()))[0]

	if (!user) {
		ctx.body = {
			status: 400,
			message: '用户不存在!',
			data: {},
		}
		return
	}

	const resource_recommended_with_id = (await common.pool.queryAsync(squel.select().from('resource_recommended_log').where('recommended_user_id = ?', userId)
		.where('resource_id = ?', data.resourceId)
		.where('recommended_type = ?', 1)
		.toString()))[0]

	if (!resource_recommended_with_id) {
		ctx.body = {
			status: 400,
			message: '未存在推荐资源需要退款!',
			data: {},
		}
		return
	}

	let connon

	try {
		connon = await common.pool.getConnectionAsync()

		await connon.beginTransactionAsync()

		await connon.queryAsync(squel.update().table('resource_recommended_log').set('recommended_type', 2).toString())

		await connon.queryAsync(squel.update().table('user').set('balance = balance + 5').where('id = ?', userId)
			.toString())

		await connon.commitAsync()

		// await reflushCount(data.circleId)
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

module.exports = {
	resource, resource_list, circle_with_user_join, resource_collect, upload_img, resource_list_with_myself, list_with_user_collect, resource_recommended, resource_recommended_refund,
}
