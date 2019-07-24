const _ = require('lodash')
const Koa = require('koa')
const koaqs = require('koa-qs')
const Router = require('koa-router')
const body = require('koa-body')
const compress = require('koa-compress')
const https = require('https')
const fs = require('fs')

const config = require('../../config.js')

const app = new Koa()
const router = new Router()

const options = {
	key: fs.readFileSync('./src/cert/woyezhi.key'),
	cert: fs.readFileSync('./src/cert/woyezhi.pem'),
}

app.use(compress())
app.use(body({ multipart: true, parsedMethods: ['post', 'put', 'get', 'delete'], formidable: { maxFileSize: 400 * 1024 * 1024, maxFields: 10, maxFieldsSize: 4000 * 1024 * 1024 } }))
koaqs(app)

function enableRouter() {
	app.use(router.routes())
	app.use(router.allowedMethods())
}


const DEFAULT_CONFIG = {
	port: 443,
	host: '0.0.0.0',
}

const conf = _.extend(DEFAULT_CONFIG, config.web)
const port = process.env.port || conf.port
const host = process.env.host || conf.host

https.createServer(options, app.callback()).listen(port, host, () => {
	console.log('Start Http Server @ %s:%s', host, port)
})

module.exports = {
	app,
	router,
	enableRouter,
}
