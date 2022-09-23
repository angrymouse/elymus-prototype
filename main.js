const {
	app,
	BrowserWindow,
	Menu,
	Tray,
	ipcMain,
	session,
	protocol,
} = require("electron");
const { playdoh } = require("playdoh");
const pino = require("pino");

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { PassThrough } = require("stream");
protocol.registerSchemesAsPrivileged([
	{
		scheme: "repens",
		privileges: {
			bypassCSP: true,
			secure: true,
			corsEnabled: true,
			standard: true,
			supportFetchAPI: true,
			allowServiceWorkers: true,
		},
	},
	{
		scheme: "elymus",
		privileges: {
			bypassCSP: true,
			secure: true,
			corsEnabled: true,
			standard: true,
			supportFetchAPI: true,
			allowServiceWorkers: true,
		},
	},
	{
		scheme: "ipfs",
		privileges: {
			bypassCSP: true,
			secure: true,
			corsEnabled: true,
			standard: true,
			supportFetchAPI: true,
			allowServiceWorkers: true,
		},
	},
	{
		scheme: "arweave",
		privileges: {
			bypassCSP: true,
			secure: true,
			corsEnabled: true,
			standard: true,
			supportFetchAPI: true,
			allowServiceWorkers: true,
		},
	},
]);

const unhandled = require("electron-unhandled");

unhandled();
const logger = pino(
	pino.destination(
		path.join(
			require("os").homedir(),
			"elymus-fastify-log-" + Date.now() + ".txt"
		)
	)
);

async function startup() {
	let IPFS = await import("ipfs");
	let { default: fetch } = await import("node-fetch");
	let { default: HNSDResolver } = await import("hnsd.js");
	let mime = require("mime");
	let yauzl = require("yauzl");
	let fetchMethods = require("./fetchMethods/combine");
	if (fs.existsSync(path.join(require("os").homedir(), ".elymus-ipfs"))) {
		fs.rmSync(path.join(require("os").homedir(), ".elymus-ipfs"), {
			recursive: true,
			force: true,
		});
	}

	const dns = require("dns");

	const util = require("util");

	let { request, stream } = require("undici");

	const Store = require("electron-store");

	let win = null;
	let tray = null;

	let store = new Store({
		watch: true,
		defaults: {
			userSettings: {
				arweaveGateway: "arweave.net",
				skynetPortal: "siasky.net",
				cacheSize: 20,
			},
			setuped: false,
		},
	});

	const createWindow = () => {
		win = new BrowserWindow({
			title: "Elymus",
			show: false,
			width: 1000,
			height: 700,
			enableLargerThanScreen: true,
			icon: path.join(__dirname, "src", "assets", "logo-01.png"),
			webPreferences: {
				preload: path.join(__dirname, "preload.js"),
				webviewTag: true,
			},
		});
		win.on("close", () => {
			win = null;
		});
		win.once("ready-to-show", () => {
			win.show();
		});
		win.loadURL(
			process.env.DEBUG ? "http://localhost:3000" : "http://localhost:1111/"
		);
	};

	app.on("window-all-closed", () => {
		win = null;
	});
	const fastify = require("fastify")({
		logger,
	});
	fastify.addHook("preHandler", (request, reply, done) => {
		reply.setHeader("Access-Control-Allow-Origin", "*");
		if (request.hostname.endsWith(".repens.localhost:1111")) {
			let hnsName = request.hostname.slice(0, -".repens.localhost:1111".length);
			(async () => {
				if (!global.hnsd.synced) {
					reply
						.code(503)
						.send(
							"Handshake node isn't synchronized yet! Try in few minutes. (Height " +
								global.hnsd.height +
								")"
						);

					return;
				}

				let domainInfo = await global.hnsd.rootResolver.resolveRaw(
					hnsName,
					"TXT"
				);
				let filepath;
				if (request.url == "/") {
					filepath = "/index.html";
				} else {
					filepath = request.url;
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
					reply
						.code(500)
						.send("Repens protocol is not enabled on this domain!");
				} else {
					if (
						!txtMap.data_hash ||
						!txtMap.data_hash[0] ||
						!Buffer.from(txtMap.data_hash[0], "hex") ||
						Buffer.from(txtMap.data_hash[0], "hex").length != 32
					) {
						reply.code(500).send("Invalid data hash");

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
										reply.code(500).send("Failed parsing site archive");

										return;
									}
									let resEntry = null;
									let notFoundEntry = null;
									zip.on("entry", (entry) => {
										if (filepath.slice(1) == entry.fileName) {
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
											reply
												.code(404)
												.send("404: File not found in archive of the resource");

											return;
										}
										if (!resEntry) {
											zip.openReadStream(notFoundEntry, {}, (err, stream) => {
												if (err) {
													reply.code(404).send("Failed parsing site archive");

													return;
												}
												reply.raw.writeHead(200, {
													"content-type": mime.getType(notFoundEntry.fileName),
												});
												stream.on("data", (data) => {
													reply.raw.write(data);
												});
												stream.on("end", () => {
													reply.raw.end();
												});
												// stream.pipe(reply.raw);
											});
											return;
										} else {
											zip.openReadStream(resEntry, {}, (err, stream) => {
												if (err) {
													reply.code(571).send("Failed parsing site archive");

													return;
												}
												reply.raw.writeHead(200, {
													"content-type": mime.getType(resEntry.fileName),
												});
												stream.on("data", (data) => {
													reply.raw.write(data);
												});
												stream.on("end", () => {
													reply.raw.end();
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
			})();
		} else {
			done();
		}
	});
	// Declare a route
	fastify.get("/api/show", async (request, reply) => {
		if (!win) {
			createWindow();
		} else {
			await win.show();

			await win.setAlwaysOnTop(true);
			win.setAlwaysOnTop(false);
		}
		return { okay: true };
	});
	fastify.register(require("@fastify/static"), {
		root: path.join(__dirname, "ui-static/public"),
		prefix: "/", // optional: default '/'
	});

	// Run the server!
	const start = async (app) => {
		try {
			let { body } = await request("http://localhost:1111/api/show");
			if ((await body.json()).okay) {
				return app.exit();
			}
		} catch (e) {
			try {
				global.ipfs = await IPFS.create({
					repoAutoMigrate: true,
					repo: path.join(require("os").homedir(), ".elymus-ipfs"),
				});
				global.hnsd = new HNSDResolver();
				fastify.get("/api/getStoreValue", async () => {
					return store.get(key);
				});
				ipcMain.handle("get-store-value", (event, key) => {
					return store.get(key);
				});
				fastify.get("/api/setStoreValue", async (request) => {
					return store.set(request.query);
					// return store.get(key);
				});
				ipcMain.handle("set-store-values", (event, entries) => {
					return store.set(entries);
				});
				fastify.get("/api/stopApp", async (request) => {
					app.quit();
				});
				ipcMain.handle("stop-app", () => {
					app.quit();
				});
				fastify.get("/api/hnsd-status", async (request) => {
					return {
						synced: global.hnsd.synced,
						height: global.hnsd.height,
					};
				});

				createWindow();

				tray = new Tray(path.join(__dirname, "icon.png"));
				const contextMenu = Menu.buildFromTemplate([
					{
						label: "Stop and close Elymus",
						type: "normal",
						role: "quit",
					},
				]);
				tray.setToolTip("Elymus Configuration");
				tray.setContextMenu(contextMenu);
				tray.on("click", () => {
					if (!win) {
						createWindow();
					} else {
						win.show();
					}
				});
				app.on("activate", () => {
					if (BrowserWindow.getAllWindows().length === 0) createWindow();
				});
				await fastify.listen({ port: 1111 });
				hnsd.launch().then(() => {});
			} catch (err) {
				fastify.log.error(err);
				process.exit(1);
			}
		}
	};

	app.whenReady().then(() => {
		require("./protocols/repens")(protocol);
		start(app);
	});
}
startup();
app;
function createStream(text) {
	const rv = new PassThrough(); // PassThrough is also a Readable stream
	rv.push(text);
	rv.push(null);
	return rv;
}
