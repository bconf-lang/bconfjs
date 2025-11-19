/**
 * @import { KeyPart, Operator, ParsedNumber, Value } from './types.js'
 * @import { Token } from './lexer.js'
 */

import { Keywords, tokenize, TokenType } from "./lexer.js";
import { BUILT_IN_TAGS } from "./resolvers.js";
import { KeyPath, Tag } from "./values.js";

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
	/** @type {Record<string, unknown>} */ result = {};

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

	isTag() {
		return (
			this.currToken.type === TokenType.IDENTIFIER &&
			!this.currToken.literal?.includes("+") &&
			this.peek().type === TokenType.LPAREN
		);
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
				part.key = this.parseString();
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
	 * @returns {KeyPath}
	 */
	parseKey() {
		/** @type {Array<KeyPart>} */
		const parts = [];

		parts.push(...this.parseKeySegment());
		while (this.currToken.type === TokenType.DOT) {
			this.advance();
			parts.push(...this.parseKeySegment());
		}

		return new KeyPath(parts);
	}

	/**
	 * @param {string} stopToken
	 * @returns {Operator}
	 */
	parseOperator(stopToken) {
		switch (this.currToken.type) {
			case TokenType.APPEND:
				this.advance();
				return "append";
			case TokenType.ASSIGN:
				this.advance();
				return "assign";
			case TokenType.LBRACE:
				return "object-shorthand";
			case TokenType.NEWLINE:
			case TokenType.EOF:
			case stopToken:
				return "true-shorthand";
			case TokenType.COMMA:
				if (stopToken === TokenType.EOF) {
					throw new Error("Unexpected token as operator");
				}
				return "true-shorthand"; // This accounts for trailing commas in objects like `{foo,}`
			case TokenType.IDENTIFIER:
			case TokenType.BOOLEAN:
			case TokenType.NULL:
			case TokenType.LBRACKET:
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				this.advance();
				return "statement";
			default:
				throw new Error("Unexpected token as operator");
		}
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

		if (
			resolvedNumber.charAt(0) === "_" ||
			resolvedNumber.charAt(resolvedNumber.length - 1) === "_"
		) {
			throw new Error("Cannot have leading or trailing underscores for number");
		}

		// Pretty naive way of checking if there are consecutive underscores, but it works
		if (resolvedNumber.includes("__")) {
			throw new Error("Cannot have consecutive underscores for number");
		}

		// Need to replace the underscores for the conversion since it's an invalid number otherwise
		const value = Number(resolvedNumber.replaceAll("_", ""));
		if (isNaN(value)) {
			throw new Error("Invalid number");
		} else if (value === Infinity || value === -Infinity) {
			// Following the spec that infinity values are not supported
			throw new Error("Infinity value not supported");
		}

		return { type, value };
	}

	/**
	 * @returns {string}
	 */
	parseEmbeddedValue() {
		this.advance(); // Consume `${`

		if (!this.currToken.literal) {
			throw new Error("Unexpected empty literal");
		}

		/** @type {string} */
		let value;
		switch (this.currToken.type) {
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				value = this.parseString();
				break;
			case TokenType.VARIABLE:
				// TODO: resolve variable value
				value = "";
				break;
			case TokenType.IDENTIFIER:
				if (this.isTag()) {
					const parsed = this.parseTag();
					if (parsed instanceof Tag) {
						throw new Error("Cannot have unresolved tag in embedded value");
					}

					value = String(parsed);
				} else {
					value = String(this.parseNumber().value);
				}
				break;
			case TokenType.NULL:
			case TokenType.BOOLEAN:
				value = this.currToken.literal;
				break;
			default:
				throw new Error("unexpected token in embedded value");
		}

		if (this.currToken.type !== TokenType.EMBEDDED_VALUE_END) {
			throw new Error("Expected closing brace '}' for embedded value");
		}

		this.advance(); // Consume `}`
		return value;
	}

	parseEscapedValue() {
		if (!this.currToken.literal) {
			throw new Error("Unexpect empty value for escaped value");
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

	parseString() {
		const boundary = this.currToken.type;
		this.advance(); // Consume `"` or `"""`

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

		if (this.currToken.type !== boundary) {
			throw new Error("Expected closing brace '}' for object");
		}

		this.advance(); // Consume `"` or `"""`
		return resolved;
	}

	parseTag() {
		if (!this.currToken.literal) {
			throw new Error("Unexpected empty tag name");
		}

		const tagName = this.currToken.literal;
		this.advance(); // Consume tag name

		if (this.currToken.type !== TokenType.LPAREN) {
			throw new Error("Expected opening brace '(' for tag");
		}
		this.advance(); // Consume `(`

		let value = this.parseValue(true);
		const resolver = BUILT_IN_TAGS.get(tagName);
		if (resolver) {
			value = resolver(value, {
				resolve: (path) => getValueAtPath(this.result, path),
			});
		}

		if (this.currToken.type !== TokenType.RPAREN) {
			throw new Error("Expected opening brace ')' for tag");
		}

		if (value instanceof KeyPath || value instanceof Tag) {
			value = value.serialize();
		}
		this.advance(); // Consume `)`
		return resolver ? value : new Tag(tagName, value);
	}

	parseObject() {
		this.advance(); // Consume `{`

		/** @type {Record<string, unknown>} */
		const obj = {};
		this.parseBlock(TokenType.RBRACE, obj);
		if (this.currToken.type !== TokenType.RBRACE) {
			throw new Error("Expected closing brace '}' for object");
		}

		this.advance(); // Consume `}`
		return obj;
	}

	parseArray() {
		this.advance(); // Consume `[`

		/** @type {Array<unknown>} */
		const arr = [];
		while (
			this.currToken.type !== TokenType.RBRACKET &&
			this.currToken.type !== TokenType.EOF
		) {
			// Skip newlines used for formatting
			while (this.currToken.type === TokenType.NEWLINE) {
				this.advance();
			}

			// Guarding against cases where its just lots of empty newlines at the end of the array
			if (
				this.currToken.type === TokenType.RBRACKET ||
				this.currToken.type === TokenType.EOF
			) {
				break;
			}

			arr.push(this.parseValue());

			if (this.currToken.type === TokenType.COMMA) {
				this.advance();
			}
		}

		if (this.currToken.type !== TokenType.RBRACKET) {
			throw new Error("Expected closing brace ']' for array");
		}

		this.advance(); // Consume `]`
		return arr;
	}

	/**
	 * @param {boolean=} allowBareKeys
	 * @returns {Value}
	 */
	parseValue(allowBareKeys = false) {
		switch (this.currToken.type) {
			case TokenType.IDENTIFIER: {
				if (this.isTag()) {
					const tagValue = this.parseTag();
					return tagValue instanceof Tag ? tagValue.serialize() : tagValue;
				}

				const firstChar = this.currToken.literal ? this.currToken.literal[0] : "";
				const isDigit = firstChar >= "0" && firstChar <= "9";
				const isSign = firstChar === "-" || firstChar === "+";

				if (isDigit || isSign) {
					return this.parseNumber().value;
				}

				if (allowBareKeys) {
					return this.parseKey();
				}

				throw new Error(
					`Unexpected identifier '${this.currToken.literal}' in value position.`
				);
			}
			case TokenType.NULL:
				this.advance();
				return null;
			case TokenType.BOOLEAN: {
				const value = this.currToken.literal === Keywords.TRUE;
				this.advance();
				return value;
			}
			case TokenType.LBRACE:
				return this.parseObject();
			case TokenType.LBRACKET:
				return this.parseArray();
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				return this.parseString();
			default:
				throw new Error("Unexpected token for value");
		}
	}

	/**
	 * @param {string} stopToken
	 * @param {Record<string, unknown>} root
	 */
	parseBlock(stopToken, root) {
		// Determine if commas are allowed based on context
		const isRoot = stopToken === TokenType.EOF;

		while (this.currToken.type !== stopToken && this.currToken.type !== TokenType.EOF) {
			// Skip newlines used for formatting
			while (this.currToken.type === TokenType.NEWLINE) {
				this.advance();
			}

			// Guarding against cases where its just lots of empty newlines at the end of the file
			if (this.currToken.type === TokenType.EOF || this.currToken.type === stopToken) {
				break;
			}

			const key = this.parseKey().parts;
			const lastKey = key[key.length - 1];
			if (lastKey.index === null && !lastKey.key) {
				throw new Error("Somehow ended up with an empty key....");
			}

			const operator = this.parseOperator(stopToken);
			switch (operator) {
				case "append": {
					// TODO
					break;
				}
				case "assign":
				case "object-shorthand":
				case "true-shorthand": {
					const parent = getParentForKey(root, key);
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

			if (!isRoot && this.currToken.type === TokenType.COMMA) {
				this.advance();
			}
		}
	}

	/**
	 * @returns {Record<string, unknown>}
	 */
	parse() {
		this.parseBlock(TokenType.EOF, this.result);
		return this.result;
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
