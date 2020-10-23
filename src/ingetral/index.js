// const OSS = require('ali-oss')
// const _ = require('lodash')
// const fs = require('fs')
// const uuid = require('uuid/v4')
const moment = require('moment')
const ajv = require('ajv')({ useDefaults: true })
const squel = require('squel')

const common = require('../common')
// const config = require('../../config')

const schemaAddIngetral = {
	properties: {
		ingetral_type: { type: 'number' },
	},
	required: ['ingetral_type'],
}

//  ingetral_type : 1为登陆，2为分享，3为添加资源，4为付费资源被刷新
async function add_ingetral(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaAddIngetral)

	if (!valid(data) || !data.ingetral_type) {
		ctx.body = {
			status: 400,
			message: '参数错误',
			data: {},
		}
		return
	}

	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	const integral_key = await common.redisClient.getAsync(`${userId}_integral_add_wiith_${data.ingetral_type}`)

	if (!integral_key) {
		await common.pool.queryAsync(squel.update().table('user').set(`integral = integral + ${data.ingetral_type === 1 ? 50 : 100}`)
			.where('id = ?', userId)
			.toString())

		await common.pool.queryAsync(squel.insert().into('integral_log').setFields({
			integral: data.ingetral_type === 1 ? 50 : 100,
			integral_channel: data.ingetral_type,
			create_time: moment().unix(),
		}).toString())

		await common.redisClient.setexAsync(`${userId}_integral_add_wiith_${data.ingetral_type}`, moment().endOf('day').unix() - moment().unix(), 'true')
	}

	ctx.body = {
		status: 200,
		message: 'success',
		data: {},
	}
}

module.exports = {
	add_ingetral,
}
