module.exports = {
	web: {
		port: 6666,
	},
	mysql: {
		host: process.env.MYSQL_HOST || 'localhost',
		port: process.env.MYSQL_PORT || 3306,
		user: process.env.MYSQL_USER || 'root',
		password: process.env.MYSQL_PASSWORD || '123456',
		database: process.env.MYSQL_DATABASE || 'mini',
	},
	redis: {
		host: process.env.REDIS_HOST || 'localhost',
		port: process.env.REDIS_PORT || 6379,
	},
	wx: {
		mch_id: process.env.WX_MCH_ID || '',
		qr_code_url: 'https://api.weixin.qq.com/wxa/getwxacodeunlimit',
		access_token_url: 'https://api.weixin.qq.com/cgi-bin/token',
		login_url: 'https://api.weixin.qq.com/sns/jscode2session',
		wx_pay_url: 'https://api.mch.weixin.qq.com/pay/unifiedorder',
		app_id: process.env.WX_APP_ID || '',
		app_secret: process.env.WX_APP_SECRET || '',
	},
	ali: {
		msg_accesskey_id: process.env.MSG_ACCESSKEY_ID || '',
		msg_accesskey_secret: process.env.MSG_ACCESSKEY_SECRET || '',
		sms_url: 'https://dysmsapi.aliyuncs.com/',
		sms_code: process.env.SMS_CODE || 'SMS_169111430',
	},
	limit: {
		addResourceWithDay: 50,
		reflushCount: 30,
		createCircleCount: 50,
		startSchedule: process.env.START_SCHEDULE || false,
	},
}
