/**
 * @import { KeyPart, ParsedNumber } from './types.js'
 * @import { Token } from './lexer.js'
 */

import { tokenize, TokenType } from "./lexer.js";

/**
 * Parse a bconf file
 * @param {string} input Input bconf file
 */
export function parse(input) {
	const parser = new Parser();
	return parser.parse(input);
}

export class Parser {
	/** @type {Token[]} */ tokens = [];
	/** @type {Token} */ currToken = this.tokens[0]; // This is being assigned in the `parse` method, so this just suppresses an error
	/** @type {number} */ tokenIndex = 0;

	constructor() {}

	/**
	 * @param {number=} n
	 * @returns {Token}
	 */
	peek(n = 0) {
		const nextIndex = this.tokenIndex + n;
		if (nextIndex >= this.tokens.length) {
			return this.tokens[this.tokens.length];
		}

		return this.tokens[nextIndex];
	}

	advance() {
		this.tokenIndex++;
		this.currToken = this.tokens[this.tokenIndex];
	}

	/**
	 * @param {string | Array<string>} expectedTypes The types of tokens to expect
	 * @throws {Error}
	 * @returns {boolean}
	 */
	expect(expectedTypes) {
		const token = this.peek();
		const types = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
		return types.includes(token.type);
	}

	/**
	 * TODO
	 * @returns {string}
	 */
	parseString() {
		return "";
	}

	/**
	 * TODO
	 * @returns {ParsedNumber}
	 */
	parseNumber() {
		return { type: "integer", value: 1 };
	}

	parseArrayIndexAccessor() {
		if (this.currToken.type !== TokenType.LBRACKET) {
			return null;
		}

		this.advance(); // Consume `[`
		const result = this.parseNumber();

		// Floats are not allowed
		if (result.type === "float") {
			throw new Error("Floats are not allowed to in an array accessor");
		}

		// Only positive integers are allowed
		if (result.value < 0) {
			throw new Error("Not allowed to have negative integers in array accessor");
		}

		this.advance(); // Consume IDENTIFIER token
		this.advance(); // Consume `]`
		return result.value;
	}

	/**
	 * @returns {KeyPart}
	 */
	parseKeyPart() {
		const token = this.peek();
		if (!token.literal) {
			throw new Error("Internal error -- the literal should not be null if parsing a key");
		}

		if (token.type === TokenType.IDENTIFIER) {
			if (token.literal.includes("+")) {
				throw new Error("Not an actual alphanumeric key");
			}

			this.advance();

			return {
				type: "alphanumeric",
				value: token.literal,
				index: this.parseArrayIndexAccessor(),
			};
		}

		if (token.type === TokenType.DOUBLE_QUOTE) {
			const value = this.parseString();
			if (value === "") {
				throw new Error("Cannot have an empty string as a key");
			}

			return { type: "string", value, index: this.parseArrayIndexAccessor() };
		}

		throw new Error("Unexpected/invalid token type part of a key");
	}

	/**
	 * @returns {KeyPart[]}
	 */
	parseKey() {
		/** @type {KeyPart[]} */
		const parts = [];

		// Consume the first key part
		parts.push(this.parseKeyPart());

		while (this.currToken.type === TokenType.DOT) {
			this.advance();
			parts.push(this.parseKeyPart());
		}

		return parts;
	}

	/**
	 * @param {string} input The file to parse
	 * @returns {Record<string, unknown>}
	 */
	parse(input) {
		/** @type {Map<string, unknown>} */
		const variables = new Map();
		/** @type {Record<string, unknown>} */
		const result = {};

		this.tokens = tokenize(input).filter(
			(t) => t.type !== TokenType.COMMENT && t.type !== TokenType.WHITESPACE
		);

		this.currToken = this.tokens[0];
		while (this.currToken.type !== TokenType.EOF) {
			// NOTE: Anything that would require a newline as a delimiter should
			// consume it - this will simply skip newlines used for formatting
			while (this.currToken.type === TokenType.NEWLINE) {
				this.advance();
			}

			// Guarding against cases where its just lots of empty newlines
			// at the end of the file
			if (this.currToken.type === TokenType.EOF) {
				break;
			}

			const key = this.parseKey();
		}

		return result;
	}

	/**
	 * @param {string} input The file to parse
	 * @returns {{ error: Error } | { result: Record<string, unknown> }}
	 */
	safeParse(input) {
		try {
			const result = this.parse(input);
			return { result };
		} catch (error) {
			// TODO: Improve type of this (custom error?)
			return { error: /** @type {Error} */ (error) };
		}
	}
}
