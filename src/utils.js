/** @import { KeyPart } from './types.js' */

import { KeyPath } from "./values.js";

/**
 * @param {Record<string, unknown>} root
 * @param {Array<KeyPart>} key
 * @returns {Array<unknown> | Record<string, unknown>}
 */
export function getParentForKey(root, key) {
	/** @type {Array<unknown> | Record<string, unknown>} */
	let current = root;

	for (let i = 0; i < key.length; i++) {
		const part = key[i];
		const isLastPart = i === key.length - 1;

		if (part.key) {
			if (isLastPart && part.index === null) {
				break;
			}

			current = ensureContainer(current, part.key, part.index !== null ? "array" : "object");
		}

		if (part.index !== null) {
			if (isLastPart) {
				break;
			}

			const nextPart = key[i + 1];
			// This is to consider if its a deeply nested property inside an array
			// (eg. `foo.bar[0].baz` or `foo.bar[0][0]`) so the value can be properly created
			const isNextPartArrayChain = !nextPart?.key && nextPart.index !== null;
			current = ensureContainer(
				current,
				part.index,
				isNextPartArrayChain ? "array" : "object"
			);
		}
	}

	return current;
}

/**
 * @param {Record<string, unknown> | Array<unknown>} parent
 * @param {string | number} key
 * @param {'array' | 'object'} type
 * @returns {Record<string, unknown> | Array<unknown>}
 */
function ensureContainer(parent, key, type) {
	// Casting should be fine here - callers should have the logic
	// to use the correct key
	const existing = /** @type {Record<string | number, unknown>} */ (parent)[key];

	if (type === "array" && Array.isArray(existing)) {
		return existing;
	}

	if (type === "object" && isObject(existing)) {
		return existing;
	}

	const newContainer = type === "array" ? [] : {};

	if (Array.isArray(parent) && typeof key === "number") {
		while (parent.length < key) {
			parent.push(null);
		}

		if (key >= parent.length) {
			parent.push(newContainer);
		} else {
			parent[key] = newContainer;
		}
	} else {
		// `parent` is always going to be an object here regardless, TS just doesn't like
		// the union type used
		/** @type {Record<string, unknown>} */ (parent)[key] = newContainer;
	}

	return newContainer;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isObject(value) {
	return typeof value === "object" && !Array.isArray(value) && value !== null;
}

/**
 * Safely retrieves a value from the root object using a KeyPath.
 * Returns undefined if any part of the path does not exist or
 * if the structure does not match (e.g. expecting an array but found an object).
 * @param {Record<string, unknown> | Array<unknown>} root - The data structure to traverse
 * @param {KeyPath} path - The parsed KeyPath object
 * @returns {unknown | undefined}
 */
export function getValueAtPath(root, path) {
	let current = root;

	for (const part of path.parts) {
		if (part.key) {
			if (!isObject(current)) {
				return undefined;
			}

			current = /** @type {Record<string, unknown>} */ (current[part.key]);
		}

		if (current === undefined) {
			return undefined;
		}

		if (part.index !== null) {
			if (!Array.isArray(current)) {
				return undefined;
			}

			current = /** @type {Array<unknown>} */ (current[part.index]);
		}

		if (current === undefined) {
			return undefined;
		}
	}

	return current;
}

/**
 * @param {string} input
 * @returns {number}
 * @throws {Error}
 */
export function validateAndParseNumber(input) {
	if (input.charAt(0) === "_" || input.charAt(input.length - 1) === "_") {
		throw new Error("Cannot have leading or trailing underscores for number");
	}

	// Pretty naive way of checking if there are consecutive underscores, but it works
	if (input.includes("__")) {
		throw new Error("Cannot have consecutive underscores for number");
	}

	// Need to replace the underscores for the conversion since it's an invalid number otherwise
	const value = Number(input.replaceAll("_", ""));
	if (isNaN(value)) {
		throw new Error("Invalid number");
	} else if (value === Infinity || value === -Infinity) {
		// Following the spec that infinity values are not supported
		throw new Error("Infinity value not supported");
	}

	return value;
}
