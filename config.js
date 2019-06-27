module.exports = {
	web: {
		port: 80,
	},
	mysql: {
		host: process.env.MYSQL_HOST || 'localhost',
		port: process.env.MYSQL_PORT || 3306,
		user: process.env.MYSQL_USER || 'root',
		password: process.env.MYSQL_PASSWORD || 'root',
		database: process.env.MYSQL_DATABASE || 'mini',
	},
	redis: {
		host: process.env.REDIS_HOST || 'localhost',
		port: process.env.REDIS_PORT || 6379,
	},
	wx: {
		login_url: 'https://api.weixin.qq.com/sns/jscode2session',
		app_id: process.env.WX_APP_ID || 'wx9a9124e8c1fd84be',
		app_secret: process.env.WX_APP_SECRET || '991e3c3db2b31d5e865d86a1b71e3c58',
	},
	ali: {
		msg_accesskey_id: process.env.MSG_ACCESSKEY_ID || 'LTAIMNMBmn9rzQ59',
		mag_accesskey_secret: process.env.MSG_ACCESSKEY_SECRET || 'YS1dP30FCmsqGiRJRe7rwe62TxAUEC',
		sms_url: 'https://dysmsapi.aliyuncs.com/',
		sms_code: process.env.SMS_CODE || 'SMS_169111430',

	},
}
