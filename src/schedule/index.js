const schedule = require('node-schedule')
const request = require('request-promise')
const Emitter = require('events')
const config = require('../../config')
const commom = require('../common')

const wxAccessTokenOption = {
	url: config.wx.access_token_url,
	qs: {
		grant_type: 'client_credential',
		appid: config.wx.app_id,
		secret: config.wx.app_secret,
	},
}

class MyEmitter extends Emitter {}

const myEmitter = new MyEmitter()

const schedules = {}

function register_schedule(name, cron, task, has_start) {
	if (!has_start) {
		return
	}
	if (schedules[name]) {
		console.log('schedule', name, 'reload') // eslint-disable-line no-console
		schedules[name].cancel()
	}
	schedules[name] = schedule.scheduleJob(cron, async () => {
		try {
			await task()
		} catch (e) {
			console.error('run schedule error', e.stack) // eslint-disable-line no-console
		}
	})
	// return schedules[name]
}

async function getAccessToken() {
	const accessTokenResult = await request(wxAccessTokenOption)

	console.log('accessTokenResult', accessTokenResult)

	await commom.redisClient.setAsync('wx_access_token', JSON.parse(accessTokenResult).access_token)
}

myEmitter.on('start_schedule', () => {
	console.log('1111111111111111111111111')

	register_schedule('get_access_token', '0 0 * * * *', getAccessToken, config.limit.startSchedule)
})

module.exports = {
	myEmitter,
}
