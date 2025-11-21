/** @import { FileLoader } from '../types.js' */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** @type {FileLoader} */
export async function resolveFile(root, path, opts = {}) {
	const finalPath = resolve(root, path);

	const { controller = new AbortController(), timeout = 10000 } = opts;
	const abortTimeout = setTimeout(() => {
		controller.abort();
	}, timeout);

	const file = await readFile(finalPath, {
		encoding: "utf-8",
		signal: controller.signal,
	}).catch(() => {
		throw new Error(`No such file or directory ${finalPath}`);
	});
	clearTimeout(abortTimeout);

	return file;
}
