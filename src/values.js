/** @import { Key, Value } from './types.js' */

import { isObject } from "./utils.js";

export class KeyPath {
	/** @type {Array<Key>} */ parts;

	/**
	 * @param {Array<Key>=} parts
	 */
	constructor(parts) {
		this.parts = parts ?? [];
	}

	/**
	 * @param {Key} key
	 */
	addKey(key) {
		this.parts.push(key);
	}

	serialize() {
		let result = "";
		for (let i = 0; i < this.parts.length; i++) {
			const part = this.parts[i];
			if (part.type === "index") {
				result += `[${part.index}]`;
			} else {
				if (i > 0) {
					result += ".";
				}

				result += part.key;
			}
		}

		return result;
	}
}

export class Tag {
	/**
	 * @param {string} name
	 * @param {Value} arg
	 */
	constructor(name, arg) {
		this.name = name;
		this.arg = arg;
	}

	serialize() {
		return [this.name, this.arg];
	}
}

export class Statement {
	/**
	 * @param {KeyPath} name
	 * @param {Array<Array<Value>>} args
	 */
	constructor(name, args) {
		this.name = name;
		this.args = args;
	}
}

/**
 * Value used when collecting different values when encountering duplicate keys
 */
export class Collection {
	/** @type {Array<Value>} */ collected = [];

	/**
	 * @param {Array<Value>=} values
	 */
	constructor(values) {
		if (values?.length) {
			this.collected = values;
		}
	}

	/**
	 * @param {Value} value
	 */
	add(value) {
		this.collected.push(value);
	}

	get last() {
		return this.collected[this.collected.length - 1];
	}
}

/**
 * Unwrap internal types (Statement, Tag, KeyPath) into their
 * serializable forms (arrays, tuples, strings, etc)
 * @param {unknown} value
 * @returns {unknown}
 */
export function unwrap(value) {
	if (value instanceof Statement) {
		// Argument values might contain internal types (ie. Tag)
		// which also need to be unwrapped
		return unwrap(value.args);
	}

	if (value instanceof Tag) {
		// The value inside the tag might need serialization too
		return [value.name, unwrap(value.arg)];
	}

	if (value instanceof KeyPath) {
		// KeyPaths become strings "foo.bar[0]"
		return value.serialize();
	}

	if (value instanceof Collection) {
		// Unwrap the last value assigned to the collection
		return unwrap(value.last);
	}

	if (Array.isArray(value)) {
		return value.map(unwrap);
	}

	if (isObject(value)) {
		/** @type {Record<string, unknown>} */
		const out = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = unwrap(v);
		}
		return out;
	}

	return value;
}
