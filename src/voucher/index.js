// const OSS = require('ali-oss')
const _ = require('lodash')
// const fs = require('fs')
// const uuid = require('uuid/v4')
const moment = require('moment')
const ajv = require('ajv')({ useDefaults: true })
const squel = require('squel')

const common = require('../common')
// const config = require('../../config')

// const schemaAddIngetral = {
// 	properties: {
// 		circle_id: { type: 'string' },
// 	},
// 	required: ['circle_id'],
// }

// async function get_voucher_info(ctx) {
// 	const data = ctx.request.body

// 	const valid = ajv.compile(schemaAddIngetral)

// 	if (!valid(data) || !data.circle_id) {
// 		ctx.body = {
// 			status: 400,
// 			message: '参数错误',
// 			data: {},
// 		}
// 		return
// 	}

// 	const { sessionid } = ctx.request.header

// 	const userId = await common.getUserId(sessionid)

// 	const circle

// 	ctx.body = {
// 		status: 200,
// 		message: 'success',
// 		data: {},
// 	}
// }

const schemaVoucherTradAction = {
	properties: {
		circleId: { type: 'string', minLength: 1 },
		count: { type: 'number', minimum: 1 },
	},
	required: ['circleId', 'count'],
}

async function voucher_trad_action(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaVoucherTradAction)

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

	const circle_detail = (await common.pool.queryAsync(squel.select().from('circle').where('id = ?', data.circleId).toString()))[0]

	if (!circle_detail) {
		ctx.body = {
			status: 400,
			message: '该圈子不存在!',
			data: {},
		}
		return
	}

	console.log('(circle_detail.voucher_price || 5) * 5).toFixed(2)', ((circle_detail.voucher_price || 5) * data.count).toFixed(2))

	if (user.balance >= ((circle_detail.voucher_price || 5) * data.count).toFixed(2)) { // 用户余额大于推荐费用，直接减
		let connon

		try {
			connon = await common.pool.getConnectionAsync()

			await connon.beginTransactionAsync()

			console.log('new Array(data.count).fill(0)', new Array(data.count).fill(0))

			await Promise.all(_.map(new Array(data.count).fill(0), () => connon.queryAsync(squel.insert().into('voucher').setFields({
				voucher_money: circle_detail.voucher_price || 5,
				circle_id: data.circleId,
				user_id: userId,
				create_time: moment().unix(),
			}).toString())))

			await connon.queryAsync(squel.update().table('user').set(`balance = balance - ${((circle_detail.voucher_price || 5) * data.count).toFixed(2)}`)
				.where('id = ?', userId)
				.toString())

			await connon.commitAsync()

			// await reflushCount(data.circleId)
		} catch (e) {
			console.log('e', e)
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

async function get_user_voucher(ctx) {
	const { sessionid } = ctx.request.header

	const userId = await common.getUserId(sessionid)

	// const user = (await common.pool.queryAsync(squel.select().from('user').where('id = ?', userId).toString()))[0] || {}

	// const voucher_count_obj = (await common.pool.queryAsync(squel.select().from('voucher').where('user_id = ?', userId)
	// 	.where('voucher_status = ?', 0)
	// 	.toString()))[0] || {}

	const voucher_list = await common.pool.queryAsync(squel.select().from('voucher', 'a').join('circle', 'b', 'a.circle_id = b.id')
		.field('*')
		.field('a.create_time as voucher_time')
		.where('a.user_id = ?', userId)
		.where('voucher_status = ?', 0)
		.toString())

	ctx.body = {
		status: 200,
		message: 'success',
		data: _.map(voucher_list, v => ({ ...v, use_time: moment(v.voucher_time * 1000).add(1, 'month').format('YYYY-MM-DD') })) || [],
	}
}

module.exports = {
	voucher_trad_action, get_user_voucher,
}
