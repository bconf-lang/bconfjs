/** @import { FileLoader } from '../types.js' */

/**
 * @param {string} root
 * @param {string} path
 */
function resolvePath(root, path) {
	root = root.startsWith("/") ? root : `/${root}`;
	return new URL(path, window.location.origin + root).href;
}

/** @type {FileLoader} */
export async function resolveFile(root, path, opts = {}) {
	const finalPath = resolvePath(root, path);

	const { controller = new AbortController(), timeout = 15000, ...rest } = opts;
	const abortTimeout = setTimeout(() => {
		controller.abort();
	}, timeout);

	const res = await fetch(finalPath, { signal: controller.signal, ...rest });
	clearTimeout(abortTimeout);
	if (!res.ok) {
		throw new Error(`could not fetch file '${finalPath}'`);
	}

	const blob = await res.blob();
	return await blob.text();
}
