/** @import { KeyPart, Value } from './types.js' */

export class KeyPath {
	/** @param {Array<KeyPart>} parts */
	constructor(parts) {
		this.parts = parts;
	}

	serialize() {
		let result = "";
		for (let i = 0; i < this.parts.length; i++) {
			const part = this.parts[i];
			// Add dot if it's a named key and not the very first part
			if (part.key && i > 0) {
				result += ".";
			}
			if (part.key) {
				result += part.key;
			}
			if (part.index !== null) {
				result += `[${part.index}]`;
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
	 * @param {Array<Value>} args
	 */
	constructor(name, args) {
		this.name = name;
		this.args = args;
	}
}
