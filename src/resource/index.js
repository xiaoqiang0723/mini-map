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
		lat: { type: 'number' },
		lng: { type: 'number' },
		wxchat: { type: 'string' },
		fenshiqun: { type: 'string' },
		douyin: { type: 'string' },
		remark: { type: 'string' },
	},
	required: ['circleId', 'resrouceName', 'lat', 'lng'],
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
		await common.redisClient.expireAsync(`${moment().endOf('day').unix() - moment(Date.now()).unix()}`)
		return
	}
	await common.redisClient.incrbyAsync(`${circleId}_reflush`, 1)
}

async function resource(ctx) {
	const { method } = ctx.request

	if (method === 'GET') {
		console.log('1111')
		const data = ctx.query

		console.log('data', data)
	} else if (method === 'POST') {
		console.log('22222')
		const data = ctx.request.body
		console.log('data', data)

		const { files } = ctx.request

		console.log('files', files)
		const valid = ajv.compile(schemaResource)

		if (!valid(data)) {
			ctx.status = 400
			ctx.body = '参数错误'
			return
		}

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const userHasAddWithToday = (await common.pool.queryAsync(squel.select().from('resource').where('user_id = ?', userId).where('create_time > ?', moment().startOf('day').unix())
			.toString()))[0]

		if (userHasAddWithToday) {
			ctx.status = 400
			ctx.body = '亲，今天您已经添加过资源了，请改天再试试吧'
			return
		}

		const resources = await common.pool.queryAsync(squel.select().from('resource').where('circle_id = ?', data.circleId).toString())

		if (resources.length >= 100) {
			ctx.status = 400
			ctx.body = '该圈子可添加的资源数量已到达上限!'
			return
		}

		const resourcesWithToday = _.filter(resources, v => v.create_time > moment().startOf('day').unix())

		if (resourcesWithToday.length >= 3) {
			ctx.status = 400
			ctx.body = '该圈子今天添加的资源数已超过限制，请改天再试试吧'
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

		ctx.status = 200
		ctx.body = 'success'
	} else if (method === 'PUT') {
		console.log('33333')
		const data = ctx.request.body

		const valid = ajv.compile(schemaResourcePut)

		if (!valid(data)) {
			ctx.status = 400
			ctx.body = '参数错误'
			return
		}
		console.log('1111')

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const resourceWithId = (await common.pool.queryAsync(squel.select().from('resource').field('user_id').where('id = ?', data.resourceId)
			.toString()))[0]

		if (!resourceWithId) {
			ctx.status = 400
			ctx.body = '该资源不存在'
			return
		}

		if (resourceWithId.user_id !== userId) {
			ctx.status = 400
			ctx.body = '您无权限编辑该资源'
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
	} else if (method === 'DELETE') {
		console.log('4444444444')

		const data = ctx.request.body

		const valid = ajv.compile(schemaResourceDelete)

		if (!valid(data)) {
			ctx.status = 400
			ctx.body = '参数错误'
			return
		}

		const { sessionid } = ctx.request.header

		const userId = await common.getUserId(sessionid)

		const resourceWithId = (await common.pool.queryAsync(squel.select().from('resource').where('id = ?', data.resourceId).toString()))[0]

		if (!resourceWithId) {
			ctx.status = 400
			ctx.body = '该资源不存在!'
			return
		}
		if (userId !== resourceWithId.user_id) {
			const circle = (await common.pool.queryAsync('circle').where('id = ?', resourceWithId.circle_id).toString())[0]

			ctx.status = 400

			if (!circle) {
				ctx.body = '该圈子已解散!'
				return
			}

			if (userId !== circle.user_id) {
				ctx.body = '您没有权限删除该资源!'
				return
			}
		}

		await common.pool.queryAsync(squel.delete().from('resource').where('id = ?', data.resourceId).toString())

		ctx.status = 200
		ctx.body = 'success'
	}
}


module.exports = {
	resource,
}
