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
	},
	required: ['circleId', 'resrouceName', 'lat', 'lng'],
}

const schemaResourceGet = {
	properties: {
		resourceId: { type: 'string' },
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

async function putStream(files) {
	const clientCopy = _.cloneDeep(client)
	const list = _.map(files, v => clientCopy.putStream(`imgs/${uuid().replace(/-/g, '')}${v.name.substring(v.name.lastIndexOf('.'))}`, fs.createReadStream(v.path), { contentLength: v.size }))

	if (list.length === 0) {
		return 0
	}

	const result = await Promise.all(list)

	return result
}

async function deleteMulti(fileNames) {
	const clientCopy = _.cloneDeep(client)
	const result = await clientCopy.deleteMulti(fileNames, { quite: true })

	console.log('result', result)

	return result
}

async function reflushCount(circleId) {
	const reflushCountWithCircleId = await common.redisClient.getAsync(`${circleId}_reflush`)

	if (!reflushCountWithCircleId) {
		await common.redisClient.setAsync(`${circleId}_reflush`, '1')
		await common.redisClient.expireAsync(`${circleId}_reflush`, `${moment().endOf('day').unix() - moment(Date.now()).unix()}`)
		return
	}
	await common.redisClient.incrbyAsync(`${circleId}_reflush`, 1)
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

		const resourceWithId = (await common.queryAsync(squel.select().from('resource').where('id = ?', data.resourceId).toString()))[0] || {}

		const imgs = await common.queryAsync(squel.select().from('resource_pic').field('pic_url').where('resource_id = ?', data.resourceId)) || []

		resourceWithId.imgs = imgs

		ctx.body = {
			status: 200,
			message: 'success',
			data: resourceWithId,
		}
	} else if (method === 'POST') {
		console.log('22222')
		const data = ctx.request.body
		console.log('data', data)

		const { files } = ctx.request

		console.log('files', files)
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

		const userHasAddWithToday = (await common.pool.queryAsync(squel.select().from('resource').where('user_id = ?', userId).where('create_time > ?', moment().startOf('day').unix())
			.toString()))[0]

		if (userHasAddWithToday) {
			ctx.body = {
				status: 400,
				message: '亲，今天您已经添加过资源了，请改天再试试吧',
				data: {},
			}
			return
		}

		const resources = await common.pool.queryAsync(squel.select().from('resource').where('circle_id = ?', data.circleId).toString())

		if (resources.length >= 100) {
			ctx.body = {
				status: 400,
				message: '该圈子可添加的资源数量已到达上限!',
				data: {},
			}
			return
		}

		const resourcesWithToday = _.filter(resources, v => v.create_time > moment().startOf('day').unix())

		if (resourcesWithToday.length >= 3) {
			ctx.body = {
				status: 400,
				message: '该圈子今天添加的资源数已超过限制，请改天再试试吧',
				data: {},
			}
			return
		}

		console.log('data', data)

		const result = await putStream(files.file)

		console.log('result', result)

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

		if (result.length > 0) {
			console.log('111111')
			await common.pool.queryAsync(squel.insert().into('resource_pic').setFieldsRows(_.map(result, v => ({
				resource_id: resourceId,
				pic_name: v.name,
				pic_url: v.url,
				create_time: moment().unix(),
			}))).toString())
		}
		await reflushCount(data.circleId)

		ctx.body = {
			status: 200,
			message: 'success',
			data: {},
		}
	} else if (method === 'PUT') {
		console.log('33333')
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
		console.log('1111')

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

		if (resourceWithId.user_id !== userId) {
			ctx.body = {
				status: 400,
				message: '您无权限编辑该资源',
				data: {},
			}
			return
		}

		let connon

		try {
			connon = common.pool.getConnectionAsync()

			await connon.beginTransactionAsync()

			if (data.imgIds) {
				const imgs = await connon.queryAsync(squel.select().from('resource_pic').where('resource_id = ?', data.resourceId).toString())

				const deleteImgs = _.differenceBy(imgs, _.map(data.imgIds, v => ({ id: v })), 'id')

				if (deleteImgs.length > 0) {
					await deleteMulti(_.map(deleteImgs, v => v.pic_name))
				}
			}

			const { file } = ctx.request.files

			let result = []
			if (file.length > 0) {
				result = await putStream(file) || []
			}

			if (result.length > 0) {
				console.log('111111')
				await connon.queryAsync(squel.insert().into('resource_pic').setFieldsRows(_.map(result, v => ({
					resource_id: data.resourceId,
					pic_name: v.name,
					pic_url: v.url,
					create_time: moment().unix(),
				}))).toString())
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

			await reflushCount(data.circleId)
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
		console.log('4444444444')

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
		if (userId !== resourceWithId.user_id) {
			const circle = (await common.pool.queryAsync('circle').where('id = ?', resourceWithId.circle_id).toString())[0]

			ctx.body = {
				status: 400,
				message: '',
				data: {},
			}

			if (!circle) {
				ctx.body.message = '该圈子已解散!'
				return
			}

			if (userId !== circle.user_id) {
				ctx.body.message = '您没有权限删除该资源!'
				return
			}
		}

		await common.pool.queryAsync(squel.delete().from('resource').where('id = ?', data.resourceId).toString())

		ctx.body.status = 200
		ctx.body.message = 'success'
	}
}

const schemaResourceList = {
	properties: {
		circleId: { type: 'string' },
		lat: { type: 'string' },
		lng: { type: 'string' },
		isFlush: { type: 'number' },
	},
	required: ['circleId', 'lat', 'lng', 'isFlush'],
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
		console.log('111')

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const flushCount = await common.redisClient.getAsync(`${userId}_flushCount`) || 0

		if (Number(flushCount) >= 3) {
			ctx.body = {
				status: 400,
				message: '您已经刷新超过3次了',
				data: {},
			}
			return
		}

		const has_show_resourceStr = await common.redisClient.getAsync(`${userId}_has_show_resources`)

		let has_show_resourceList = []

		if (has_show_resourceStr) {
			has_show_resourceList = JSON.parse(has_show_resourceStr)
		}

		if (has_show_resourceList.length >= 10 && !data.isFlush) {
			ctx.status = 200
			ctx.body = _.drop(has_show_resourceList, has_show_resourceList.length - 10)
			return
		}

		const resources = await common.pool.queryAsync(squel.select().from('resource').where('circle_id = ?', data.circleId).order('id', false)
			.toString())

		const resourcesWithNear = _.differenceBy(_.filter(resources, v => (Math.abs(Number(v.lat) - Number(data.lat)) <= 10) && (Math.abs(Number(v.lng) - Number(data.lng)) <= 10)), has_show_resourceList, 'id')

		let returnList = []

		if (resourcesWithNear.length >= 10) {
			returnList = _.sortBy(resourcesWithNear, () => (0.5 - Math.random())).slice(0, 10) || []
		} else {
			returnList = _.sortBy(resourcesWithNear, () => (0.5 - Math.random())).slice(0, 10) || []
		}

		has_show_resourceList = _.concat(has_show_resourceList, returnList)

		await common.redisClient.setAsync(`${userId}_has_show_resources`, JSON.stringify(has_show_resourceList))
		await common.redisClient.expireAsync(`${userId}_has_show_resources`, 60 * 60)
		await common.redisClient.delAsync(`${userId}_collect`)
		await common.redisClient.setAsync(`${userId}_last_join_circle`, `${data.circleId}`)

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
	await common.redisClient.expireAsync(60 * 60)

	if (user_has_collect) {
		ctx.body = {
			status: 400,
			message: '请刷新后再点击收藏',
			data: {},
		}
		return
	}

	await common.pool.queryAsync(squel.insert().into('user_collect').setFields({
		id: uuid().replace(/-/g, ''),
		resource_id: data.resourceId,
		user_id: userId,
		create_time: moment().unix(),
	}))

	ctx.body = {
		status: 200,
		message: 'success',
		data: {},
	}
}

module.exports = {
	resource, resource_list, circle_with_user_join, resource_collect,
}
