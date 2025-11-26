/** @import { FileLoader } from '../index.js' */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** @type {FileLoader} */
export async function resolveFile(root, path, opts = {}) {
	const finalPath = resolve(root, path);

	const { controller = new AbortController(), timeoutMS = 10000 } = opts;
	const abortTimeout = setTimeout(() => {
		controller.abort();
	}, timeoutMS);

	const file = await readFile(finalPath, {
		encoding: "utf-8",
		signal: controller.signal,
	}).catch(() => {
		throw new Error(`no such file or directory '${finalPath}'`);
	});
	clearTimeout(abortTimeout);

	return file;
}
