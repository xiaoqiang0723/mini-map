const ajv = require('ajv')({ useDefaults: true })
const squel = require('squel')
const _ = require('lodash')
const request = require('request-promise')
const moment = require('moment')
const uuid = require('uuid/v4')
const crypto = require('crypto')

const common = require('../common')
const config = require('../../config')
const WXBizDataCrypt = require('./lib/WXBizDataCrypt')

const schemaWithLogin = {
	properties: {
		code: { type: 'string', minLength: 1 },
		encryptedData: { type: 'string', minLength: 1 },
		iv: { type: 'string', minLength: 1 },
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

	console.log('data', data)

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
	let result = await request(wxLoginOptionCopy)
	console.log('wx login result <<<<< ', result)
	result = JSON.parse(result)

	if (!result.openid) {
		ctx.status = 400
		ctx.body = '系统繁忙,请稍后再试'
		return
	}

	const user = (await common.pool.queryAsync(squel.select().from('user').where('id = ?', result.openid).toString()))[0]

	console.log('user', user)

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

	console.log('userData', userData)

	if (!user) {
		await common.pool.queryAsync(squel.insert().into('user').setFields({
			id: userData.openId,
			phone: data.phone,
			nick_name: userData.nickName || '',
			gender: userData.gender || 0,
			city: userData.city || '',
			province: userData.province || '',
			avatar_url: userData.avatarUrl || '',
			union_id: userData.unionId,
			create_time: moment().unix(),
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
		await common.pool.queryAsync(sql.toString())
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
	qs: {},
	JSON: true,
}

const schemaGetAuthCode = {
	properties: {
		phone: { type: 'string' },
	},
	required: ['phone'],
}

function sign(signObj, secretKey) {
	let qstring = []
	const keys = Object.keys(signObj)
	if (keys.length === 0) {
		return 0
	}
	for (let i = 0; i < keys.length; i += 1) {
		qstring.push(`${encodeURIComponent(keys[i])}=${encodeURIComponent(signObj[keys[i]])}`)
	}
	qstring = _.join(qstring, '&').replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')
	// qstring = `GET&${encodeURIComponent('/')}&${qstring}`

	console.log('qstring', `GET&${encodeURIComponent('/')}&${encodeURIComponent(qstring).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')}`)
	const signs = crypto.createHmac('sha1', `${secretKey}&`).update(`GET&${encodeURIComponent('/')}&${encodeURIComponent(qstring).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')}`).digest().toString('base64')
	return signs
}

async function get_auth_code(ctx) {
	const data = ctx.request.body

	const valid = ajv.compile(schemaGetAuthCode)

	if (!valid(data)) {
		ctx.status = 400
		ctx.body = '请输入手机号'
		return
	}

	const { ip } = ctx.request
	let punishment_time = await common.redisClient.getAsync(`${ip}_${data.phone}_number`)
	if (punishment_time > 10) {
		await common.redisClient.expireAsync(`${ip}_${data.phone}_number`, moment().endOf('day').unix() - moment(Date.now()).unix())
		ctx.status = 400
		ctx.body = '请求次数频繁,请稍后再试'
		return
	}

	if (Number(punishment_time) > 0) {
		punishment_time = `${Number(punishment_time) + 1}`
	} else {
		punishment_time = 1
	}

	await common.redisClient.setAsync(`${ip}_${data.phone}_number`, `${punishment_time}`)

	const authCode = uuid().replace(/-/g, '').substr(0, 6)
	const signatureNonce = uuid()
	const timestamp = `${moment(new Date().getTime() - 3600 * 1000 * 8).format('YYYY-MM-DDTHH:mm:ss')}Z`

	const signObj = {
		AccessKeyId: config.ali.msg_accesskey_id,
		Action: 'SendSms',
		Format: 'json',
		PhoneNumbers: data.phone,
		RegionId: 'cn-zhuhai',
		SignName: '你知我知',
		SignatureMethod: 'HMAC-SHA1',
		SignatureNonce: signatureNonce,
		SignatureVersion: '1.0',
		TemplateCode: config.ali.sms_code,
		TemplateParam: `${JSON.stringify({ code: authCode })}`,
		Timestamp: timestamp,
		Version: '2017-05-25',
	}

	const signStr = sign(signObj, config.ali.msg_accesskey_secret)

	console.log('signStr', signStr)

	const smsoptionCopy = _.cloneDeep(smsoption)
	smsoptionCopy.qs.Signature = signStr
	smsoptionCopy.qs.AccessKeyId = signObj.AccessKeyId
	smsoptionCopy.qs.Action = signObj.Action
	smsoptionCopy.qs.Format = signObj.Format
	smsoptionCopy.qs.PhoneNumbers = signObj.PhoneNumbers
	smsoptionCopy.qs.RegionId = signObj.RegionId
	smsoptionCopy.qs.SignName = signObj.SignName
	smsoptionCopy.qs.SignatureMethod = signObj.SignatureMethod
	smsoptionCopy.qs.SignatureNonce = signObj.SignatureNonce
	smsoptionCopy.qs.SignatureVersion = signObj.SignatureVersion
	smsoptionCopy.qs.TemplateCode = signObj.TemplateCode
	smsoptionCopy.qs.TemplateParam = signObj.TemplateParam
	smsoptionCopy.qs.Timestamp = signObj.Timestamp
	smsoptionCopy.qs.Version = signObj.Version

	console.log('request aliyun sms >>>>>>>', JSON.stringify(smsoptionCopy))
	let result = await request(smsoptionCopy)
	console.log('request aliyun sms <<<<<<<', result)

	console.log('result', result)

	result = JSON.parse(result)

	if (result.Code !== 'OK') {
		ctx.status = 500
		ctx.body = '系统繁忙,请稍后再试'
		return
	}

	await common.redisClient.setAsync(`get_phone_code_${data.phone}`, authCode)
	await common.redisClient.expireAsync(`get_phone_code_${data.phone}`, 10 * 60)

	ctx.status = 200
	ctx.body = 'success'
}

module.exports = {
	login, get_auth_code,
}
