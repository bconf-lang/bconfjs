/**
 * @import { KeyPart, Operator, ParsedNumber } from './types.js'
 * @import { Token } from './lexer.js'
 */

import { tokenize, TokenType } from "./lexer.js";

const EXPONENT_REGEX = /[eE]/;

/**
 * Parse a bconf file
 * @param {string} input Input bconf file
 */
export function parse(input) {
	const parser = new Parser(input);
	return parser.parse();
}

class Parser {
	/** @type {Array<Token>} */ tokens;
	/** @type {Token} */ currToken;
	/** @type {number} */ pos;

	/**
	 * @param {string} input The file to parse
	 */
	constructor(input) {
		this.pos = 0;
		this.tokens = tokenize(input).filter(
			(t) => t.type !== TokenType.COMMENT && t.type !== TokenType.WHITESPACE
		);
		this.currToken = this.tokens[this.pos];
	}

	/**
	 * @param {number=} n The number of tokens to peek ahead
	 * @returns {Token}
	 */
	peek(n = 1) {
		const nextIndex = this.pos + n;
		if (nextIndex >= this.tokens.length) {
			return this.tokens[this.tokens.length - 1];
		}

		return this.tokens[nextIndex];
	}

	advance(count = 1) {
		this.currToken = this.peek();
		this.pos += count;
	}

	/**
	 * @returns {KeyPart}
	 */
	parseKeyLiteral() {
		if (!this.currToken.literal) {
			throw new Error("The literal should not be null when parsing a key part");
		}

		/** @type {KeyPart} */
		const part = {
			key: "",
			index: null,
			type: "alphanumeric",
		};
		switch (this.currToken.type) {
			case TokenType.VARIABLE:
				part.type = "variable";
				part.key = this.currToken.literal;
				break;
			case TokenType.IDENTIFIER:
				if (this.currToken.literal.includes("+")) {
					throw new Error("Not an actual alphanumeric key");
				}

				part.type = "alphanumeric";
				part.key = this.currToken.literal;
				break;
			case TokenType.DOUBLE_QUOTE:
				part.type = "string";
				part.key = this.currToken.literal; // TODO: Parse string value
				break;
			default:
				throw new Error("Unexpected key type");
		}

		this.advance();
		return part;
	}

	/**
	 * @returns {number}
	 * @throws {Error}
	 */
	parseArrayIndex() {
		this.advance(); // Consume `[`
		if (this.currToken.type !== TokenType.IDENTIFIER) {
			throw new Error("Expected index number inside brackets");
		}

		const index = this.parseNumber();
		if (index.type === "float") {
			throw new Error("Index cannot be a float");
		}

		if (index.value < 0) {
			throw new Error("Cannot have negative index number");
		}

		if (this.currToken.type !== TokenType.RBRACKET) {
			throw new Error("Expected closing bracket ']'");
		}

		this.advance(); // Consume `]`
		return index.value;
	}

	/**
	 * @returns {Array<KeyPart>}
	 */
	parseKeySegment() {
		const parts = [];

		let currentPart = this.parseKeyLiteral();

		// Account for multi-dimensional arrays (eg. `foo.bar[0][0]`) which
		// have multiple array indexes
		while (this.currToken.type === TokenType.LBRACKET) {
			const index = this.parseArrayIndex();

			// First array index, so it should be attached directly to the key.
			// Otherwise, its a multi-dimensional array index which should be treated
			// separately (later logic will know how to attach these keys to the array)
			if (currentPart.index === null) {
				currentPart.index = index;
			} else {
				parts.push(currentPart);
				// Empty `key` value signifies its purely an index key
				currentPart = { type: "alphanumeric", key: "", index };
			}
		}

		parts.push(currentPart);

		return parts;
	}

	/**
	 * @returns {Array<KeyPart>}
	 */
	parseKey() {
		/** @type {Array<KeyPart>} */
		const parts = [];

		parts.push(...this.parseKeySegment());
		while (this.currToken.type === TokenType.DOT) {
			this.advance();
			parts.push(...this.parseKeySegment());
		}

		return parts;
	}

	/**
	 * @returns {Operator}
	 */
	parseOperator() {
		/** @type {Operator} */
		let operator;
		switch (this.currToken.type) {
			case TokenType.APPEND:
				operator = "append";
				break;
			case TokenType.ASSIGN:
				operator = "assign";
				break;
			case TokenType.LBRACE:
				operator = "object-shorthand";
				break;
			case TokenType.NEWLINE:
			case TokenType.EOF:
				operator = "true-shorthand";
				break;
			case TokenType.IDENTIFIER:
			case TokenType.BOOLEAN:
			case TokenType.NULL:
			case TokenType.LBRACKET:
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				operator = "statement";
				break;
			default:
				throw new Error("Unexpected token as operator");
		}

		this.advance();
		return operator;
	}

	parseStatement() {}

	/**
	 * @returns {ParsedNumber}
	 */
	parseNumber() {
		if (this.currToken.type !== TokenType.IDENTIFIER) {
			throw new Error("Expected IDENTIFIER token");
		}

		let resolvedNumber = this.currToken.literal ?? "";
		/** @type {ParsedNumber['type']} */
		let type = "integer";
		if (EXPONENT_REGEX.test(resolvedNumber)) {
			type = "float";
		}

		this.advance();

		// Building a float. Any exponents without a fractional (ie. `123e4`)
		// should already be collected by the first token, so we only need to check
		// for the DOT token to see if there is a fraction present
		if (this.currToken.type === TokenType.DOT) {
			type = "float";
			resolvedNumber += ".";
			this.advance();
			if (this.currToken.type !== TokenType.IDENTIFIER) {
				throw new Error("Invalid float");
			}

			resolvedNumber += this.currToken.literal ?? "";
			this.advance();
		}

		const value = Number(resolvedNumber);
		if (isNaN(value)) {
			throw new Error("Invalid number");
		} else if (value === Infinity || value === -Infinity) {
			// Following the spec that infinity values are not supported
			throw new Error("Infinity value not supported");
		}

		return { type, value };
	}

	parseValue() {
		this.advance();
		return "";
	}

	/**
	 * @returns {Record<string, unknown>}
	 */
	parse() {
		/** @type {Record<string, unknown>} */
		const result = {};

		while (this.currToken.type !== TokenType.EOF) {
			// Skip newlines used for formatting
			while (this.currToken.type === TokenType.NEWLINE) {
				this.advance();
			}

			// Guarding against cases where its just lots of empty newlines at the end of the file
			if (this.currToken.type === TokenType.EOF) {
				break;
			}

			const key = this.parseKey();
			const lastKey = key[key.length - 1];
			if (lastKey.index === null && !lastKey.key) {
				throw new Error("Somehow ended up with an empty key....");
			}

			const operator = this.parseOperator();
			switch (operator) {
				case "append": {
					// TODO
					break;
				}
				case "assign":
				case "object-shorthand":
				case "true-shorthand": {
					const parent = getParentForKey(result, key);
					const value = operator === "true-shorthand" ? true : this.parseValue();
					const keyToUse = lastKey.index ?? lastKey.key;

					// Typecasting parent here should be fine. Its going to be an array or object
					// anyways, and will use the correct key (number for array index if it exists,
					// otherwise a the key value)
					/** @type {Record<string | number, unknown>} */ (parent)[keyToUse] = value;
					break;
				}
				case "statement": {
					// TODO:
					break;
				}
			}
		}

		return result;
	}
}

/**
 * @param {Record<string, unknown>} root
 * @param {Array<KeyPart>} key
 * @returns {Array<unknown> | Record<string, unknown>}
 */
function getParentForKey(root, key) {
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
function isObject(value) {
	return typeof value === "object" && !Array.isArray(value) && value !== null;
}
