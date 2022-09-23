protocol.registerStreamProtocol("http", async (request, callback) => {
	let url = new URL(request.url);
	// lookup("nb", console.log);
	const rv = new PassThrough();
	if (url.hostname == "supername") {
		return callback({
			statusCode: 200,

			mimeType: "text/html",

			data: createStream(`<h2>Supername test</h2>`),
		});
	}
	let resource = http.request(
		{
			hostname: url.hostname,
			headers: request.headers,
			port: url.port,
			method: request.method,
			lookup: lookup,
			path: url.pathname,
			searchParams: url.searchParams,
			hash: url.hash,
		},
		(res) => {
			return callback({
				statusCode: res.statusCode,

				mimeType: res.headers["content-type"],
				headers: res.headers,
				data: res,
			});
		}
	);

	resource.on("error", (error) => {
		console.log(error);
		return callback({
			statusCode: 400,
			mimeType: "text/plain",
			data: createStream(error.message),
		});
	});
	if (["PUT", "PATCH", "POST"].includes(request.method) && request.uploadData) {
		resource.write(request.uploadData.bytes);
	}
	resource.end();
});
