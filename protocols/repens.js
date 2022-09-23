const { PassThrough } = require("stream");
const http = require("http");

module.exports = async (protocol) => {
	protocol.registerStreamProtocol("repens", async (request, callback) => {
		if (!global.hnsd.synced) {
			callback({
				statusCode: 503,
				data: createStream(
					"Handshake node isn't synchronized yet! Try in few minutes. (Height " +
						global.hnsd.height +
						")"
				),
			});
			return;
		}
		let url = new URL(request.url);

		let domainInfo = await global.hnsd.rootResolver.resolveRaw(
			url.hostname,
			"TXT"
		);
		if (url.pathname == "/") {
			url.pathname = "/index.html";
		}
		let txtMap = domainInfo.answer
			.filter((rec) => {
				return (
					rec.type == 16 &&
					rec.data.txt.length > 0 &&
					rec.data.txt[0].split("=").length > 1
				);
			})
			.map((rec) => [
				rec.data.txt[0].split("=")[0],
				rec.data.txt[0].split("=").slice(1).join(""),
			])
			.reduce((pv, cv) => {
				if (pv[cv[0]]) {
					pv[cv[0]] = [...pv[cv[0]], cv[1]];
				} else {
					pv[cv[0]] = [cv[1]];
				}
				return pv;
			}, {});
		// console.log(domainInfo.authority, domainInfo.additional);

		if (!txtMap.repensprotocol || txtMap.repensprotocol[0] != "enabled") {
			let lookup = require("../coreFunctions/lookup");
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
			if (
				["PUT", "PATCH", "POST"].includes(request.method) &&
				request.uploadData
			) {
				resource.write(request.uploadData.bytes);
			}
			resource.end();
			return;
		} else {
			if (
				!txtMap.data_hash ||
				!txtMap.data_hash[0] ||
				!Buffer.from(txtMap.data_hash[0], "hex") ||
				Buffer.from(txtMap.data_hash[0], "hex").length != 32
			) {
				callback({
					statusCode: 851,
					data: Buffer.from("Invalid data hash"),
				});
				return;
			}
			let dataHash = txtMap.data_hash[0];
			if (!txtMap.data_way) {
				callback({
					statusCode: 404,
					data: Buffer.from("No ways to fetch content provided"),
				});
				return;
			}

			for (const way of txtMap.data_way) {
				if (way.split(":").length != 2) {
					continue;
				}
				let method = way.split(":")[0];
				let path = way.split(":")[1];

				if (!fetchMethods[method]) {
					continue;
				}
				let cid = await fetchMethods[method](path, dataHash, store);
				if (cid == null) {
					continue;
				} else {
					let rawArchiveChunks = [];

					for await (bf of ipfs.cat(cid)) {
						rawArchiveChunks.push(bf);
					}

					yauzl.fromBuffer(
						Buffer.concat(rawArchiveChunks),
						{},
						async (err, zip) => {
							if (err) {
								callback({
									statusCode: 571,
									data: createStream("Failed parsing site archive"),
								});
								return;
							}
							let resEntry = null;
							let notFoundEntry = null;
							zip.on("entry", (entry) => {
								if (url.pathname.slice(1) == entry.fileName) {
									resEntry = entry;
								}

								if (
									["404.html", "404/index.html", "404.txt"].includes(
										entry.fileName
									)
								) {
									notFoundEntry = entry;
								}
							});
							zip.once("end", async () => {
								if (!resEntry && !notFoundEntry) {
									callback({
										statusCode: 404,
										data: createStream(
											"404: File not found in archive of the resource"
										),
									});
									return;
								}
								if (!resEntry) {
									zip.openReadStream(notFoundEntry, {}, (err, stream) => {
										if (err) {
											callback({
												statusCode: 571,
												data: createStream("Failed parsing site archive"),
											});
											return;
										}
										callback({
											statusCode: 200,
											data: stream,
											mimeType: mime.getType(resEntry.fileName),
										});
									});
									return;
								} else {
									zip.openReadStream(resEntry, {}, (err, stream) => {
										if (err) {
											callback({
												statusCode: 571,
												data: createStream("Failed parsing site archive"),
											});
											return;
										}

										callback({
											statusCode: 200,
											data: stream,
											mimeType: mime.getType(resEntry.fileName),
										});
									});
									return;
								}
							});
						}
					);
				}
			}
		}
	});
};
function createStream(text) {
	const rv = new PassThrough(); // PassThrough is also a Readable stream
	rv.push(text);
	rv.push(null);
	return rv;
}
