module.exports = async function lookup(hostname, options, cb) {
	options = options || {};

	if (hnsd.synced) {
		try {
			let Arecords = await hnsd.recursiveResolver.resolveRaw(hostname, "A");

			let targetRecord = Arecords.answer[0];
			if (!targetRecord) {
				throw new Error("Resource empty");
			}

			return cb(null, targetRecord.data.address, 4);
		} catch (e) {
			console.error(e);
		}
	} else {
		dns.lookup(hostname, options, (err, address, family) => {
			cb(err, address, family);
		});
	}
};
