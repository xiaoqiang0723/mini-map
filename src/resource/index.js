const OSS = require('ali-oss')
const _ = require('lodash')
const fs = require('fs')
const uuid = require('uuid/v4')
const ajv = require('ajv')({ useDefaults: true })

// const common = require('../common')
const config = require('../../config')

const schemaResource = {
	properties: {

	},
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

async function resource(ctx) {
	const { method } = ctx.request

	if (method === 'GET') {
		console.log('1111')
	} else if (method === 'POST') {
		console.log('22222')
		const data = ctx.request.files

		const valid = ajv.compile(schemaResource)

		if (!valid(data)) {
			ctx.status = 400
			ctx.body = '参数错误'
			return
		}

		console.log('data', data)

		const result = await putStream(data.file)

		console.log('result', result)

		ctx.status = 200
		ctx.body = 'success'
	} else if (method === 'PUT') {
		console.log('33333')
	} else if (method === 'DELETE') {
		console.log('4444444444')
	}
}

module.exports = {
	resource,
}
