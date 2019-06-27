const ajv = require('ajv')({ useDefaults: true })
const mysql = require('mysql')
const bluebird = require('bluebird')
const squel = require('squel')
const _ = require('lodash')
const request = require('request-promise')
const moment = require('moment')
const uuid = require('uuid/v4')

const common = require('../common')
const config = require('../../config')
const WXBizDataCrypt = require('./lib/WXBizDataCrypt')

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

const wxLoginOption = {
	uri: config.wx.login_url,
	qs: {
		appid: config.wx.app_id,
		secret: config.wx.app_secret,
		grant_type: 'authorization_code',
	},
	JSON: true,
}

async function login(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaWithLogin)

	if (!valid(data)) {
		ctx.status = 400
		ctx.body = '参数错误'
		return
	}

	if (!data.phone && data.authCode) {
		ctx.status = 400
		ctx.body = '请输入手机号码'
		return
	}

	if (data.phone && !data.authCode) {
		ctx.status = 400
		ctx.body = '请输入手机验证码'
		return
	}

	if (data.phone && data.authCode) {
		const authCode = await common.redisClient.getAsync(`get_phone_code_${data.phone}`)
		if (authCode !== data.authCode) {
			ctx.status = 400
			ctx.body = '验证码错误'
			return
		}
	}
	const wxLoginOptionCopy = _.cloneDeep(wxLoginOption)
	wxLoginOptionCopy.qs.js_code = data.code
	console.log('wx login option >>>>> ', JSON.stringify(wxLoginOptionCopy))
	const result = await request(wxLoginOptionCopy)
	console.log('wx login result <<<<< ', result)

	if (!result) {
		ctx.status = 400
		ctx.body = '系统繁忙,请稍后再试'
		return
	}

	const user = (await pool.queryAsync(squel.select().from('user').where('id = ?', result.open_id).toString()))[0]
	if (!user && !data.phone && !data.authCode) {
		ctx.status = 400
		ctx.body = '请输入手机号和验证码'
		return
	}

	const pc = new WXBizDataCrypt(config.wx.app_id, result.session_key)
	const userData = pc.decryptData(data.encryptedData, data.iv)
	if (!userData || userData.watermark.appid !== config.wx.app_id) {
		ctx.status = 400
		ctx.body = '用户信息验证失败'
		return
	}

	if (!user) {
		await pool.queryAsync(squel.insert().into('user').setFields({
			id: userData.openId,
			phone: data.phone,
			nick_name: userData.nickName || '',
			gender: userData.gender || 0,
			city: userData.city || '',
			province: userData.province || '',
			avatar_url: userData.avatarUrl || '',
			union_id: userData.unionId,
		}).toString())
	} else {
		const sql = squel.update().table('user')
		if (userData.nickName) {
			sql.set('nick_name', userData.nickName)
		}
		if (userData.avatarUrl) {
			sql.set('avatar_url', userData.avatarUrl)
		}
		if (userData.city) {
			sql.set('city', userData.city)
		}
		if (userData.province) {
			sql.set('province', userData.province)
		}
		await pool.queryAsync(sql.toString())
	}

	const sessionId = common.getSessionId(userData.openId)
	common.refreshSession(sessionId)

	await common.redisClient.setAsync(sessionId, JSON.stringify(userData))

	ctx.status = 200
	ctx.body = {
		sessionId,
	}
}

const smsoption = {
	uri: config.ali.sms_url,
}

const schemaGetAuthCode = {
	properties: {
		phone: { type: 'string' },
	},
	required: ['phone'],
}

function sign(signObj, secretKey) {
	const urlStr = ''
	const objLength = Object.keys(signObj)
	if (objLength.length === 0) {
		return
	}
	for (let i = 0; i < objLength; i += 1) {
		urlStr = `&${encodeURIComponent()}`
	}
}

async function get_auth_code(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaGetAuthCode)

	if (!valid(data)) {
		ctx.status = 400
		ctx.body = '请输入手机号'
		return
	}

	const authCode = uuid().substr(0, 5)

	const signObj = {
		SignatureMethod: 'HMAC-SHA1',
		SignatureNonce: uuid(),
		AccessKeyId: config.ali.msg_accesskey_id,
		SignatureVersion: '1.0',
		Timestamp: `${moment(new Date().getTime() - 3600 * 1000 * 8).format('YYYY-MM-DDTHH:mm:ss')}Z`,
		Format: 'json',
		Action: 'SendSms',
		Version: moment().format('YYYY-MM-DD'),
		RegionId: 'cn-zhuhai',
		PhoneNumbers: data.phone,
		SignName: '你知我知',
		TemplateParam: `${JSON.stringify({ code: authCode })}`,
		TemplateCode: config.ali.sms_code,
	}
}

module.exports = {
	login,
}
