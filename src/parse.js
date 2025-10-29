/**
 * @import { KeyPart, ParsedNumber } from './types.js'
 * @import { Token } from './lexer.js'
 */

import { tokenize, TokenType } from "./lexer.js";

const EXPONENT_REGEX = /[eE]/;

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
	/** @type {Record<string, unknown>} */ variables = {};

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
	 * @returns {boolean}
	 */
	isTag() {
		return (
			this.currToken.type === TokenType.IDENTIFIER && this.peek(1).type === TokenType.LPAREN
		);
	}

	/**
	 * @param {unknown} value
	 * @returns {boolean}
	 */
	isStringable(value) {
		return (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean" ||
			value === null
		);
	}

	parseEmbeddedValue() {
		this.advance(); // Consume the EMBEDDED_VALUE_START token

		if (!this.currToken.literal) {
			throw new Error("Unexpected empty literal");
		}

		/** @type {string} */
		let value;
		if (this.expect([TokenType.DOUBLE_QUOTE, TokenType.TRIPLE_QUOTE])) {
			value = this.parseString();
		} else if (this.currToken.type === TokenType.IDENTIFIER) {
			try {
				// Only numbers are allowed as a value in embedded values.
				// Regular identifiers are illegal
				value = String(this.parseNumber().value);
			} catch (e) {
				throw new Error("Not a valid number");
			}
		} else if (this.expect([TokenType.BOOLEAN, TokenType.NULL])) {
			value = String(this.currToken.literal);
			this.advance();
		} else if (this.currToken.type === TokenType.VARIABLE) {
		} else if (this.isTag()) {
		} else {
			throw new Error("Illegal value in embedded value");
		}

		if (this.currToken.type !== TokenType.RBRACE) {
			throw new Error("Unclosed embedded value");
		}

		this.advance(); // Consume EMBEDDED_VALUE_END token

		return value;
	}

	/**
	 * @throws {Error}
	 * @returns {string}
	 */
	parseEscapedValue() {
		if (!this.currToken.literal) {
			throw new Error("No literal -- something went wrong");
		}

		const code = this.currToken.literal[1];
		switch (code) {
			case '"':
				return '"';
			case "\\":
				return "\\";
			case "$":
				return "$";
			case "b":
				return "\b";
			case "f":
				return "\f";
			case "n":
				return "\n";
			case "r":
				return "\r";
			case "t":
				return "\t";
			case "u":
			case "U":
				const codePoint = parseInt(this.currToken.literal.substring(2), 16);
				if (isNaN(codePoint)) {
					throw new Error("Invalid unicode code point in escape sequence");
				}

				try {
					return String.fromCodePoint(codePoint);
				} catch (e) {
					throw new Error("Invalid unicode code point");
				}

			default:
				throw new Error("Invalid escape sequence");
		}
	}

	/**
	 * @returns {string}
	 */
	parseString() {
		if (!this.expect([TokenType.DOUBLE_QUOTE, TokenType.TRIPLE_QUOTE])) {
			throw new Error("Invalid string");
		}

		const boundary = this.currToken.type;
		this.advance();

		let resolved = "";
		while (this.currToken.type !== boundary) {
			switch (this.currToken.type) {
				case TokenType.STRING_CONTENT:
					resolved += this.currToken.literal ?? "";
					this.advance();
					break;
				case TokenType.EMBEDDED_VALUE_START:
					resolved += this.parseEmbeddedValue();
					break;
				case TokenType.ESCAPE_SEQUENCE:
					resolved += this.parseEscapedValue();
					this.advance();
					break;
				default:
					throw new Error("Unexpected token in string");
			}
		}

		// Consuming the end of string token
		this.advance();

		return resolved;
	}

	/**
	 * @returns {ParsedNumber}
	 */
	parseNumber() {
		if (this.currToken.type !== TokenType.IDENTIFIER) {
			throw new Error("Expected IDENTIFIER token");
		}

		let resolvedNumber = this.currToken.literal;
		/** @type {ParsedNumber['type']} */
		let type = "integer";
		if (EXPONENT_REGEX.test(resolvedNumber ?? "")) {
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
		}

		const parsed = Number(resolvedNumber);
		if (isNaN(parsed)) {
			throw new Error("Invalid number");
		} else if (parsed === Infinity || parsed === -Infinity) {
			// Following the spec that infinity values are not supported
			throw new Error("Infinity value not supported");
		}

		return { type, value: parsed };
	}

	parseArrayIndexAccessor() {
		if (this.currToken.type !== TokenType.LBRACKET) {
			return null;
		}

		this.advance(); // Consume `[`
		if (this.currToken.type !== TokenType.IDENTIFIER) {
			throw new Error("Unexpected token type for array index accessor");
		}

		const result = this.parseNumber();

		// Floats and regular identifiers are not allowed
		if (result.type !== "integer") {
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

		if (token.type === TokenType.VARIABLE) {
			this.advance();
			return {
				type: "variable",
				value: token.literal,
				index: this.parseArrayIndexAccessor(),
			};
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

			// Need to check if this is a variable and add it to the internal map
			// const key = this.parseKey();
			// console.log(key);
			console.log(this.parseString());
			// TODO: Need to look ahead (currToken) to see what the operation is going to be:
			// explicit assign (=)
			// shorthand object assign ({)
			// shorthand true assign (newline or EOF since its a bare key)
			// append (<<)
			// statement (any non-object token that is not EOF)
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
