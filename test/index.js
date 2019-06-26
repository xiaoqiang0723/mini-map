const { router } = require('../src/koa')

router.get('/test', async (ctx) => {
	console.log('test')
	ctx.body = '1111111111'
})

router.post('/test', (ctx) => {
	ctx.body = '2222'
})

module.exports = {
	router,
}
