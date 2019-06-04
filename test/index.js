const { router } = require('../koa')

router.get('/test', async (ctx) => {
	console.log('test')
	ctx.body = '1111111111'
})


module.exports = {
	router,
}
