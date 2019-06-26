const ajv = require('ajv')({ useDefaults: true })
const mysql = require('mysql')
const bluebird = require('bluebird')
const _ = require('lodash')

const config = require('../../config')

const pool = mysql.createPool(_.extend(config.mysql, { multipleStatements: true }))
bluebird.promisifyAll(pool)

const schemaWithLogin = {
	properties: {
		code: { type: 'string' },
		encryptedData: { type: 'string' },
		iv: { type: 'string' },
		phone: { type: 'string' },
		authCode: { type: 'string' },
	},
	required: ['code', 'encryptedData', 'iv'],
}

async function login(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaWithLogin)

	if (!valid(data)) {
		ctx.status = 400
		ctx.body = '参数错误'
	}

	if (!data.phone && data.authCode) {
		ctx.status = 400
		ctx.body = '请输入手机号码'
	}

	if (data.phone && !data.authCode) {
		ctx.status = 400
		ctx.body = '请输入手机验证码'
	}

	console.log('data', data)
	ctx.status = 200
	ctx.body = 'success'
}

module.exports = {
	login,
}
