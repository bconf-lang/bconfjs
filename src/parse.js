/**
 * @import { KeyPart, Operator, ParsedNumber, ParseOptions, TagResolver, Value, StatementAction, StatementResolver, StatementResolverContext, FileLoader } from './types.js'
 * @import { Token } from './lexer.js'
 */

import { Keywords, tokenize, TokenType } from "./lexer.js";
import { BUILT_IN_STATEMENT_RESOLVERS, BUILT_IN_TAG_RESOLVERS } from "./resolvers.js";
import {
	deepMerge,
	getParentForKey,
	getValueAtPath,
	isObject,
	looksLikeNumber,
	validateAndParseNumber,
} from "./utils.js";
import { KeyPath, Statement, Tag } from "./values.js";

const EXPONENT_REGEX = /[eE]/;

/**
 * Parse a bconf file
 * @param {string} input Input bconf file
 * @param {ParseOptions=} opts Options for parsing
 */
export function parse(input, opts) {
	const parser = new Parser(input, opts);
	return parser.parse();
}

const browser = typeof window !== "undefined";
const defaultLoader = await (browser ? import("./browser/files.js") : import("./node/files.js"));

class Parser {
	/** @type {Array<Token>} */ tokens;
	/** @type {Token} */ currToken;
	/** @type {number} */ pos;
	/** @type {Record<string, Value>} */ result = {};

	/** @type {Map<string, StatementResolver>} */ statementResolvers = new Map(
		BUILT_IN_STATEMENT_RESOLVERS
	);
	/** @type {Map<string, TagResolver>} */ tagResolvers = new Map(BUILT_IN_TAG_RESOLVERS);
	env = /** @type {Record<string, unknown>} */ (browser ? window : process.env);
	/** @type {Record<string, Value>} */ variables = {};
	/** @type {Record<string, Value>} */ exportedVariables = {};
	/** @type {FileLoader} */ fileLoader = defaultLoader.resolveFile;
	/** @type {string} */ rootFilePath = browser ? "/" : import.meta.dirname;

	/**
	 * @param {string} input The file to parse
	 * @param {ParseOptions=} opts Options for parsing
	 */
	constructor(input, opts) {
		if (opts?.env) {
			this.env = opts.env;
		}

		if (opts?.tags) {
			for (const tag of opts.tags) {
				this.tagResolvers.set(tag.name, tag.resolver);
			}
		}

		if (opts?.statements) {
			for (const statement of opts.statements) {
				this.statementResolvers.set(statement.name, statement.resolver);
			}
		}

		if (opts?.root) {
			this.rootFilePath = opts.root;
		}

		if (opts?.fileLoader) {
			this.fileLoader = opts.fileLoader;
		}

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
	 * @returns {Promise<KeyPart>}
	 */
	async parseKeyLiteral() {
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
				part.key = await this.parseString();
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
	 * @returns {Promise<Array<KeyPart>>}
	 */
	async parseKeySegment() {
		const parts = [];

		let currentPart = await this.parseKeyLiteral();

		// Account for multi-dimensional arrays (eg. `foo.bar[0][0]`) which
		// have multiple array indexes
		while (this.currToken.type === TokenType.INDEX_LBRACKET) {
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
	 * @returns {Promise<KeyPath>}
	 */
	async parseKey() {
		/** @type {Array<KeyPart>} */
		const parts = [];

		parts.push(...(await this.parseKeySegment()));
		while (this.currToken.type === TokenType.DOT) {
			this.advance();
			parts.push(...(await this.parseKeySegment()));
		}

		return new KeyPath(parts);
	}

	/**
	 * @returns {string}
	 */
	parseStrictIdentifier() {
		if (!this.currToken.literal) {
			throw new Error("Unexpected empty literal");
		}

		const value = this.currToken.literal;
		this.advance();

		if (this.currToken.type === TokenType.DOT) {
			throw new Error("Dotted keys are not allowed in this context");
		}
		if (this.currToken.type === TokenType.INDEX_LBRACKET) {
			throw new Error("Array accessors are not allowed in this context");
		}

		return value;
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
				// Don't advance since its an actual value and should be handled by their own parsing methods
				return "statement";
			default:
				throw new Error("Unexpected token as operator");
		}
	}

	/**
	 * @param {string} stopToken
	 * @returns {Promise<Array<Value>>}
	 */
	async parseStatementArgs(stopToken) {
		/** @type {Array<Value>} */
		const values = [];

		while (
			this.currToken.type !== TokenType.NEWLINE &&
			this.currToken.type !== TokenType.EOF &&
			this.currToken.type !== stopToken &&
			// Ensuring that controls is always handed back to parseBlock to determine
			// how the comma should be handled (throw or consume)
			this.currToken.type !== TokenType.COMMA
		) {
			const parsed = await this.parseValue(true, true);
			if (parsed instanceof KeyPath) {
				throw new Error("Somehow ended up with a key path as a value in a statement");
			}

			values.push(parsed);
		}

		return values;
	}

	/**
	 * @param {KeyPath} key
	 * @param {Array<Value>} args
	 * @returns {Promise<StatementAction>}
	 */
	async resolveStatement(key, args) {
		// TODO: Create robust way to define/lookup complex statement keys? (eg. `foo.bar`, `foo[0].bar`)
		const resolver = this.statementResolvers.get(key.parts[0].key);
		if (!resolver) {
			return { action: "push", value: args };
		}

		/** @type {StatementResolverContext} */
		const context = {
			env: this.env,
			variables: this.variables,
			loadFile: (path, opts) => this.fileLoader(this.rootFilePath, path, opts),
			declareVariable: (name, value, args) => {
				// Ensuring the name is always just `$foo` and not something
				// like `$foo.bar`. Any nested values should be part of `value`
				// already, and merging of existing values should be handled by the resolver
				if (
					!name.startsWith("$") ||
					name.includes(".") ||
					name.includes("[") ||
					name.includes("]")
				) {
					return false;
				}

				// TODO: Account for args.scope
				if (!args?.exportOnly) {
					if (name in this.variables && !args?.override) {
						return false;
					}

					this.variables[name] = value;
				}

				if (args?.export) {
					if (name in this.exportedVariables && !args?.override) {
						return false;
					}

					this.exportedVariables[name] = value;
				}

				return true;
			},
			parse: async (input) => {
				const parser = new Parser(input);
				await parser.parse();
				return { data: parser.result, variables: parser.exportedVariables };
			},
		};

		const action = await resolver(args, context);
		return action;
	}

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

		const value = validateAndParseNumber(resolvedNumber);
		return { type, value };
	}

	/**
	 * @returns {Promise<string>}
	 */
	async parseEmbeddedValue() {
		this.advance(); // Consume `${`

		if (!this.currToken.literal) {
			throw new Error("Unexpected empty literal");
		}

		/** @type {string} */
		let value;
		switch (this.currToken.type) {
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				value = await this.parseString();
				break;
			case TokenType.VARIABLE:
				// TODO: resolve variable value
				value = this.currToken.literal;
				this.advance();
				break;
			case TokenType.IDENTIFIER:
				if (this.isTag()) {
					const parsed = await this.parseTag();
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

	async parseString() {
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
					resolved += await this.parseEmbeddedValue();
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

	async parseTag() {
		if (!this.currToken.literal) {
			throw new Error("Unexpected empty tag name");
		}

		const tagName = this.currToken.literal;
		this.advance(); // Consume tag name

		if (this.currToken.type !== TokenType.LPAREN) {
			throw new Error("Expected opening brace '(' for tag");
		}
		this.advance(); // Consume `(`

		let value = await this.parseValue(true);
		const resolver = this.tagResolvers.get(tagName);
		if (resolver) {
			value = resolver(value, {
				resolve: (path) => getValueAtPath(this.result, path),
				env: this.env,
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

	async parseObject() {
		this.advance(); // Consume `{`

		/** @type {Record<string, unknown>} */
		const obj = {};
		await this.parseBlock(TokenType.RBRACE, obj);
		if (this.currToken.type !== TokenType.RBRACE) {
			throw new Error("Expected closing brace '}' for object");
		}

		this.advance(); // Consume `}`
		return obj;
	}

	async parseArray() {
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

			arr.push(await this.parseValue());

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
	 * @param {boolean=} strictKeys
	 * @returns {Value | KeyPath}
	 */
	async parseValue(allowBareKeys = false, strictKeys = false) {
		switch (this.currToken.type) {
			case TokenType.IDENTIFIER: {
				if (this.isTag()) {
					return await this.parseTag();
				}

				if (looksLikeNumber(this.currToken)) {
					return this.parseNumber().value;
				}

				if (allowBareKeys) {
					return strictKeys ? this.parseStrictIdentifier() : await this.parseKey();
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
				return await this.parseObject();
			case TokenType.LBRACKET:
				return await this.parseArray();
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				return await this.parseString();
			case TokenType.VARIABLE: {
				// TODO: Resolve variable values
				const variable = this.currToken.literal;
				this.advance();
				return variable;
			}
			default:
				throw new Error("Unexpected token for value");
		}
	}

	/**
	 * @param {string} stopToken
	 * @param {Record<string, unknown>} root
	 */
	async parseBlock(stopToken, root) {
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

			const key = await this.parseKey();
			const lastKey = key.parts[key.parts.length - 1];
			if (lastKey.index === null && !lastKey.key) {
				throw new Error("Somehow ended up with an empty key....");
			}

			const keyToUse = lastKey.index ?? lastKey.key;
			const operator = this.parseOperator(stopToken);

			if (
				operator === "assign" ||
				operator === "object-shorthand" ||
				operator === "true-shorthand"
			) {
				const parent = getParentForKey(root, key);
				const value = operator === "true-shorthand" ? true : await this.parseValue();
				parent[keyToUse] = value;
			}
			//
			else if (operator === "append") {
				const parent = getParentForKey(root, key);
				let targetArray = /** @type {Array<unknown>} */ (parent[keyToUse]);
				if (!Array.isArray(targetArray)) {
					targetArray = [];
					parent[keyToUse] = targetArray;
				}

				targetArray.push(await this.parseValue());
			}
			//
			else if (operator === "statement") {
				const args = await this.parseStatementArgs(stopToken);
				const resolved = await this.resolveStatement(key, args);
				switch (resolved.action) {
					case "push": {
						const parent = getParentForKey(root, key);
						let targetStatement = /** @type {Statement} */ (parent[keyToUse]);
						if (!(targetStatement instanceof Statement)) {
							targetStatement = new Statement(key, []);
							parent[keyToUse] = targetStatement;
						}

						if (resolved.value) {
							targetStatement.args.push(resolved.value);
						}
						break;
					}
					case "merge": {
						if (!isObject(resolved.value)) {
							throw new Error("Cannot merge non object values into current document");
						}

						deepMerge(root, resolved.value);
						break;
					}
					// Nothing to do if the action is "discard"
					default:
						break;
				}
			}

			if (!isRoot && this.currToken.type === TokenType.COMMA) {
				this.advance();
			}
		}
	}

	/**
	 * @returns {Promise<Record<string, unknown>>}
	 */
	async parse() {
		await this.parseBlock(TokenType.EOF, this.result);
		return /** @type {Record<string, unknown>} */ (unwrap(this.result));
	}
}

/**
 * Unwrap internal types (Statement, Tag, KeyPath) into their
 * serializable forms (arrays, tuples, strings, etc)
 * @param {unknown} value
 * @returns {unknown}
 */
function unwrap(value) {
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
