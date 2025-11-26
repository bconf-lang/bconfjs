/**
 * @import { Key, Operation, ParsedNumber, Value, NextArgs, ResolverContext, StatementResolver, TagResolver, ParseOptions, FileLoader, StatementAction, Container, ParseResult, SerializableValue } from './index.js'
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
import { Collection, KeyPath, Statement, Tag, unwrap } from "./values.js";
import { BconfError } from "./error.js";

const EXPONENT_REGEX = /[eE]/;

/**
 * Parse a bconf file
 * @template {ParseOptions} TOptions
 * @param {string} input Input bconf file
 * @param {TOptions} [opts] Options for parsing
 * @returns {Promise<ParseResult<TOptions['unwrap'] extends true ? SerializableValue : Value>>}
 */
export function parse(input, opts) {
	const parser = new Parser(input, opts);
	return parser.parse();
}

const browser = typeof window !== "undefined";
const defaultLoader = await (browser ? import("./browser/files.js") : import("./node/files.js"));
const defaultEnv = /** @type {Record<string, unknown>} */ (browser ? window : process.env);

class Scope {
	/** @type {Record<string, Value>} */ variables = {};
	/** @type {Scope | null} */ parent;

	/**
	 * @param {Scope | null} parent
	 */
	constructor(parent) {
		this.parent = parent;
	}

	/**
	 * @param {string} name
	 * @param {Value} value
	 */
	define(name, value) {
		this.variables[name] = value;
	}

	/**
	 * @param {KeyPath} path
	 * @returns {{ found: false } | { found: true; value: Value }}
	 */
	resolve(path) {
		const value = getValueAtPath(this.variables, path);
		if (value !== undefined) {
			return { found: true, value };
		}

		if (this.parent) {
			return this.parent.resolve(path);
		}

		return { found: false };
	}
}

class Parser {
	// ----------------------
	// ROOT
	// ----------------------
	/** @type {ParseOptions} */ opts;
	/** @type {Record<string, Value>} */ result = {};

	// ----------------------
	// TOKENS
	// ----------------------
	/** @type {Array<Token>} */ tokens;
	/** @type {Token} */ currentToken;
	/** @type {number} */ position;

	// ----------------------
	// VARIABLES
	// ----------------------
	/** @type {Scope} */ rootScope = new Scope(null);
	/** @type {Scope} */ currentScope = this.rootScope;
	/** @type {Record<string, Value>} */ exportedVariables = {};

	// ----------------------
	// RESOLVERS / FILES
	// ----------------------
	resolvers = {
		/** @type {Map<string, StatementResolver>} */ statements: new Map(
			BUILT_IN_STATEMENT_RESOLVERS,
		),
		/** @type {Map<string, TagResolver>} */ tags: new Map(BUILT_IN_TAG_RESOLVERS),
	};
	/** @type {Record<string, unknown>} */ env = defaultEnv;
	/** @type {FileLoader} */ fileLoader = defaultLoader.resolveFile;
	/** @type {string} */ rootFilePath = browser ? "/" : import.meta.dirname;

	/**
	 * @param {string} input The file to parse
	 * @param {ParseOptions=} opts Options for parsing
	 */
	constructor(input, opts) {
		this.opts = opts ?? {};
		this.opts.unwrap ??= true;

		if (opts?.env) {
			this.env = opts.env;
		}

		if (opts?.resolvers?.tags) {
			for (const tag of opts.resolvers.tags) {
				this.resolvers.tags.set(tag.name, tag.resolver);
			}
		}

		if (opts?.resolvers?.statements) {
			for (const statement of opts.resolvers.statements) {
				this.resolvers.statements.set(statement.name, statement.resolver);
			}
		}

		if (opts?.rootDir) {
			this.rootFilePath = opts.rootDir;
		}

		if (opts?.loader) {
			this.fileLoader = opts.loader;
		}

		if (opts?.variables) {
			for (const [name, value] of Object.entries(opts.variables)) {
				this.currentScope.define(name, value);
			}
		}

		this.position = 0;
		this.tokens = tokenize(input).filter(
			(t) => t.type !== TokenType.COMMENT && t.type !== TokenType.WHITESPACE,
		);
		this.currentToken = this.tokens[this.position];
	}

	// ----------------------
	// GENERAL
	// ----------------------
	/**
	 * @param {number=} n The number of tokens to peek ahead
	 * @returns {Token}
	 */
	peek(n = 1) {
		const nextIndex = this.position + n;
		if (nextIndex >= this.tokens.length) {
			return this.tokens[this.tokens.length - 1];
		}

		return this.tokens[nextIndex];
	}

	advance() {
		this.currentToken = this.peek();
		this.position++;
	}

	isTag() {
		return (
			this.currentToken.type === TokenType.IDENTIFIER &&
			!this.currentToken.literal?.includes("+") &&
			this.peek().type === TokenType.LPAREN
		);
	}

	/**
	 * @param {string} stopToken
	 * @param {NextArgs} args
	 * @param {"statement" | "tag"} type
	 * @returns {ResolverContext}
	 */
	createResolverContext(stopToken, args, type) {
		return {
			file: this.opts.file,
			env: this.env,
			loadFile: (path, args) => this.fileLoader(this.rootFilePath, path, args),
			scope: this.currentScope === this.rootScope ? "root" : "object",
			nextArgs: args,
			next: async (newArgs) => {
				if (
					this.currentToken.type === stopToken ||
					this.currentToken.type === TokenType.NEWLINE ||
					this.currentToken.type === TokenType.EOF ||
					this.currentToken.type === TokenType.COMMA
				) {
					return { success: false };
				}

				const argsToUse = newArgs ?? args;
				const value = await (type === "statement"
					? this.parseStatementValue(argsToUse)
					: this.parseValue(argsToUse));

				return { success: true, value };
			},
			lookup: (path) => {
				const value = getValueAtPath(this.result, path);
				if (value === undefined) {
					return { success: false };
				}

				return { success: true, value };
			},
			variables: {
				get: (name) =>
					this.currentScope.resolve(
						name instanceof KeyPath
							? name
							: new KeyPath([{ type: "variable", key: name }]),
					),
				set: (name, value, args) => {
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

					if (!args?.exportOnly) {
						if (!args?.override && name in this.currentScope.variables) {
							return false;
						}

						if (args?.scope === "root") {
							this.rootScope.define(name, value);
						} else {
							this.currentScope.define(name, value);
						}
					}

					if (args?.export) {
						if (name in this.exportedVariables && !args?.override) {
							return false;
						}

						this.exportedVariables[name] = value;
					}

					return true;
				},
			},
			parse: (input, opts) =>
				/** @type {Promise<ParseResult>} */ (
					parse(input, { ...this.opts, ...opts, unwrap: opts?.unwrap ?? false })
				),
		};
	}

	// ----------------------
	// KEYS
	// ----------------------
	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Key>}
	 */
	async parseKeyPart(args) {
		if (!this.currentToken.literal) {
			throw new BconfError(
				"expected a valid key but got an empty literal",
				this.currentToken,
			);
		}

		if (this.currentToken.type === TokenType.DOT) {
			this.advance();
		}

		switch (this.currentToken.type) {
			case TokenType.VARIABLE: {
				/** @type {Key} */
				const key = { type: "variable", key: this.currentToken.literal };
				this.advance();
				return key;
			}
			case TokenType.IDENTIFIER: {
				if (this.currentToken.literal.includes("+")) {
					throw new BconfError("invalid key", this.currentToken);
				}
				/** @type {Key} */
				const key = { type: "alphanumeric", key: this.currentToken.literal };
				this.advance();
				return key;
			}
			case TokenType.DOUBLE_QUOTE: {
				const value = await this.parseString(args);
				if (!value) {
					throw new BconfError("unexpected empty key part", this.currentToken);
				}

				return { type: "alphanumeric", key: value };
			}
			case TokenType.INDEX_LBRACKET: {
				this.advance(); // Consume `[`
				if (this.currentToken.type !== TokenType.IDENTIFIER) {
					throw new BconfError("expected number for array index", this.currentToken);
				}

				const index = this.parseNumber();
				if (index.type === "float") {
					throw new BconfError(
						"expected array index to be an integer",
						this.currentToken,
					);
				}

				if (index.value < 0) {
					throw new BconfError(
						"expected non-negative integer for array index",
						this.currentToken,
					);
				}

				if (this.currentToken.type !== TokenType.RBRACKET) {
					throw new BconfError("expected ']'", this.currentToken);
				}

				this.advance(); // Consume `]`
				return { type: "index", index: index.value };
			}
			default:
				throw new BconfError("expected key", this.currentToken);
		}
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<KeyPath>}
	 */
	async parseKey(args) {
		const path = new KeyPath();
		path.addKey(await this.parseKeyPart(args));

		while (
			this.currentToken.type === TokenType.DOT ||
			this.currentToken.type === TokenType.INDEX_LBRACKET
		) {
			const key = await this.parseKeyPart(args);

			// Variable keys can only be the first key
			if (key.type === "variable") {
				throw new BconfError("unexpected variable key in key sequence", this.currentToken);
			}

			path.addKey(key);
		}

		return path;
	}

	// ----------------------
	// OPERATORS
	// ----------------------
	/**
	 * @param {string} stopToken
	 * @returns {Operation}
	 */
	parseOperator(stopToken) {
		switch (this.currentToken.type) {
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
			// This accounts for trailing commas in objects like `{foo,}`
			case TokenType.COMMA:
				if (stopToken === TokenType.EOF) {
					throw new BconfError("unexpected end of data", this.currentToken);
				}
				return "true-shorthand";
			case TokenType.IDENTIFIER:
			case TokenType.BOOLEAN:
			case TokenType.NULL:
			case TokenType.LBRACKET:
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				// Don't advance since its an actual value and should be handled by their own parsing methods
				return "statement";
			default:
				throw new BconfError(
					`unexpected operator '${this.currentToken.literal}'`,
					this.currentToken,
				);
		}
	}

	// ----------------------
	// TAGS
	// ----------------------
	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Value>}
	 */
	async resolveTag(args) {
		if (!this.currentToken.literal) {
			throw new BconfError("unexpected empty tag name", this.currentToken);
		}

		const tagName = this.currentToken.literal;
		this.advance(); // Consume tag name

		if (this.currentToken.type !== TokenType.LPAREN) {
			throw new BconfError(
				`expected '(', got '${this.currentToken.literal}'`,
				this.currentToken,
			);
		}
		this.advance(); // Consume `(`

		/** @type {NextArgs} */
		const newArgs = { ...args, identifiersAsValue: "keypath" };
		/** @type {Value} */
		let value;
		const resolver = this.resolvers.tags.get(tagName);
		if (resolver) {
			try {
				value = await resolver(
					this.createResolverContext(TokenType.RPAREN, newArgs, "tag"),
				);
			} catch (error) {
				if (error instanceof Error) {
					throw new BconfError(error.message, this.currentToken);
				}

				throw new BconfError("unexpected error when resolving tag", this.currentToken);
			}
		} else {
			value = await this.parseValue(newArgs);
		}

		if (this.currentToken.type !== TokenType.RPAREN) {
			throw new BconfError(
				`expected ')', got '${this.currentToken.type}'`,
				this.currentToken,
			);
		}

		this.advance(); // Consume `)`
		return resolver ? value : new Tag(tagName, value);
	}

	// ----------------------
	// STATEMENTS
	// ----------------------
	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Value>}
	 */
	async parseStatementValue(args) {
		// Enforcing that statements strictly follow what is allowed in a statement
		// so there is no ambiguity between what some statement resolvers allow, and
		// what others don't
		if (this.currentToken.type === TokenType.IDENTIFIER) {
			const value = await this.parseValue({ ...args, identifiersAsValue: "literal" });
			if (this.currentToken.type === TokenType.DOT) {
				throw new BconfError(
					"dotted keys are not allowed in statements",
					this.currentToken,
				);
			}
			if (this.currentToken.type === TokenType.INDEX_LBRACKET) {
				throw new BconfError(
					"array indexes are not allowed in statements",
					this.currentToken,
				);
			}

			return value;
		}

		return await this.parseValue(args);
	}

	/**
	 * @param {NextArgs} args
	 * @param {string} stopToken
	 * @returns {Promise<Array<Value>>}
	 */
	async parseStatementArgs(args, stopToken) {
		/** @type {Array<Value>} */
		const values = [];

		while (
			this.currentToken.type !== stopToken &&
			this.currentToken.type !== TokenType.NEWLINE &&
			this.currentToken.type !== TokenType.EOF &&
			// Ensuring that controls is always handed back to parseBlock to determine
			// how the comma should be handled (throw or consume)
			this.currentToken.type !== TokenType.COMMA
		) {
			values.push(await this.parseStatementValue(args));
		}

		return values;
	}

	/**
	 * @param {KeyPath} key
	 * @param {NextArgs} args
	 * @param {string} stopToken
	 * @returns {Promise<StatementAction>}
	 */
	async resolveStatement(key, args, stopToken) {
		if (key.parts[0].type === "index") {
			throw new BconfError(
				"expected variable key as first key, got index key",
				this.currentToken,
			);
		}

		const resolver = this.resolvers.statements.get(key.parts[0].key);
		if (!resolver) {
			return { action: "collect" };
		}

		try {
			return await resolver(this.createResolverContext(stopToken, args, "statement"));
		} catch (error) {
			if (error instanceof Error) {
				throw new BconfError(error.message, this.currentToken);
			}

			throw new BconfError("unexpected error while resolving statement", this.currentToken);
		}
	}

	// ----------------------
	// NUMBERS
	// ----------------------
	/**
	 * @returns {ParsedNumber}
	 */
	parseNumber() {
		if (this.currentToken.type !== TokenType.IDENTIFIER) {
			throw new BconfError(
				`expected number but got '${this.currentToken.literal}'`,
				this.currentToken,
			);
		}

		let resolvedNumber = this.currentToken.literal ?? "";
		/** @type {ParsedNumber['type']} */
		let type = "integer";
		if (EXPONENT_REGEX.test(resolvedNumber)) {
			type = "float";
		}

		this.advance();

		// Building a float. Any exponents without a fractional (ie. `123e4`)
		// should already be collected by the first token, so we only need to check
		// for the DOT token to see if there is a fraction present
		if (this.currentToken.type === TokenType.DOT) {
			type = "float";
			resolvedNumber += ".";
			this.advance();
			if (this.currentToken.type !== TokenType.IDENTIFIER) {
				throw new BconfError("unterminated float", this.currentToken);
			}

			resolvedNumber += this.currentToken.literal ?? "";
			this.advance();
		}

		try {
			const value = validateAndParseNumber(resolvedNumber);
			return { type, value };
		} catch (error) {
			if (error instanceof Error) {
				throw new BconfError(error.message, this.currentToken);
			}

			throw new BconfError(`could not parse number: ${error}`, this.currentToken);
		}
	}

	// ----------------------
	// STRINGS
	// ----------------------
	/**
	 * @param {NextArgs} args
	 * @returns {Promise<string>}
	 */
	async parseEmbeddedValue(args) {
		this.advance(); // Consume `${`

		if (!this.currentToken.literal) {
			throw new BconfError(
				`expected expression, got '${this.currentToken.literal}'`,
				this.currentToken,
			);
		}

		/** @type {string} */
		let value;
		switch (this.currentToken.type) {
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				value = await this.parseString(args);
				break;
			case TokenType.VARIABLE: {
				const key = await this.parseKey(args);
				const variable = this.currentScope.resolve(key);
				if (!variable.found) {
					throw new BconfError(
						`could not resolve variable '${key.serialize()}'`,
						this.currentToken,
					);
				}

				if (
					typeof variable.value !== "number" &&
					typeof variable.value !== "string" &&
					typeof variable.value !== "boolean" &&
					variable.value !== null
				) {
					throw new BconfError(
						"variable must resolve to a primitive in embedded values",
						this.currentToken,
					);
				}

				value = String(variable.value);
				break;
			}
			case TokenType.IDENTIFIER:
				if (this.isTag()) {
					const parsed = await this.resolveTag(args);
					if (parsed instanceof Tag || isObject(parsed) || Array.isArray(parsed)) {
						throw new BconfError(
							"tags must resolve to a primitive in embedded values",
							this.currentToken,
						);
					}

					value = String(parsed);
				} else {
					value = String(this.parseNumber().value);
				}
				break;
			case TokenType.NULL:
			case TokenType.BOOLEAN:
				value = this.currentToken.literal;
				this.advance();
				break;
			default:
				throw new BconfError(
					"only primitive values are allowed in embedded values",
					this.currentToken,
				);
		}

		if (this.currentToken.type !== TokenType.RBRACE) {
			throw new BconfError(
				`expected '}', got '${this.currentToken.literal}'`,
				this.currentToken,
			);
		}

		this.advance(); // Consume `}`
		return value;
	}

	parseEscapedValue() {
		if (!this.currentToken.literal) {
			throw new BconfError("unexpected empty value", this.currentToken);
		}

		const code = this.currentToken.literal[1];
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
			case "U": {
				const codePoint = parseInt(this.currentToken.literal.substring(2), 16);
				if (Number.isNaN(codePoint)) {
					throw new BconfError("invalid escaped unicode code point", this.currentToken);
				}

				try {
					return String.fromCodePoint(codePoint);
				} catch {
					throw new BconfError("invalid escaped unicode code point", this.currentToken);
				}
			}

			default:
				throw new BconfError(
					`invalid escape sequence '${this.currentToken.literal}'`,
					this.currentToken,
				);
		}
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<string>}
	 */
	async parseString(args) {
		const boundary = this.currentToken.type;
		this.advance(); // Consume `"` or `"""`

		let resolved = "";
		while (this.currentToken.type !== boundary) {
			switch (this.currentToken.type) {
				case TokenType.STRING_CONTENT:
					resolved += this.currentToken.literal ?? "";
					this.advance();
					break;
				case TokenType.EMBEDDED_VALUE_START:
					resolved += await this.parseEmbeddedValue(args);
					break;
				case TokenType.ESCAPE_SEQUENCE:
					resolved += this.parseEscapedValue();
					this.advance();
					break;
				default:
					throw new BconfError("unexpected value in string", this.currentToken);
			}
		}

		if (this.currentToken.type !== boundary) {
			throw new BconfError(
				`expected ${boundary}, got ${this.currentToken.literal}`,
				this.currentToken,
			);
		}

		this.advance(); // Consume `"` or `"""`
		return resolved;
	}

	// ----------------------
	// OBJECTS
	// ----------------------
	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Record<string, Value>>}
	 */
	async parseObject(args) {
		this.advance(); // Consume `{`

		/** @type {Record<string, Value>} */
		const obj = {};
		await this.parseBlock(TokenType.RBRACE, obj, args);
		if (this.currentToken.type !== TokenType.RBRACE) {
			throw new BconfError(
				`expected '}', got ${this.currentToken.literal}`,
				this.currentToken,
			);
		}

		this.advance(); // Consume `}`
		return obj;
	}

	// ----------------------
	// ARRAYS
	// ----------------------
	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Array<Value>>}
	 */
	async parseArray(args) {
		this.advance(); // Consume `[`

		/** @type {Array<Value>} */
		const arr = [];
		while (
			this.currentToken.type !== TokenType.RBRACKET &&
			this.currentToken.type !== TokenType.EOF
		) {
			// Skip newlines used for formatting
			while (this.currentToken.type === TokenType.NEWLINE) {
				this.advance();
			}

			// Guarding against cases where its just lots of empty newlines at the end of the array
			if (
				this.currentToken.type === TokenType.RBRACKET ||
				this.currentToken.type === TokenType.EOF
			) {
				break;
			}

			arr.push(await this.parseValue(args));

			if (this.currentToken.type === TokenType.COMMA) {
				this.advance();
			}
		}

		if (this.currentToken.type !== TokenType.RBRACKET) {
			throw new BconfError(
				`expected ']', got ${this.currentToken.literal}`,
				this.currentToken,
			);
		}

		this.advance(); // Consume `]`
		return arr;
	}

	// ----------------------
	// VALUES
	// ----------------------
	/**
	 * Get the next value until the stop token
	 * @param {NextArgs} args
	 * @returns {Promise<Value>}
	 */
	async parseValue(args) {
		switch (this.currentToken.type) {
			case TokenType.IDENTIFIER: {
				if (this.isTag()) {
					return await this.resolveTag(args);
				}

				if (looksLikeNumber(this.currentToken)) {
					return this.parseNumber().value;
				}

				if (args.identifiersAsValue === "keypath") {
					return await this.parseKey(args);
				}

				if (args.identifiersAsValue === "literal") {
					const value = this.currentToken.literal;
					this.advance();
					return value;
				}

				throw new BconfError(
					`unexpected identifier as value '${this.currentToken.literal}'`,
					this.currentToken,
				);
			}
			case TokenType.NULL:
				this.advance();
				return null;
			case TokenType.BOOLEAN: {
				const value = this.currentToken.literal === Keywords.TRUE;
				this.advance();
				return value;
			}
			case TokenType.LBRACE:
				return await this.parseObject(args);
			case TokenType.LBRACKET:
				return await this.parseArray(args);
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				return await this.parseString(args);
			case TokenType.VARIABLE: {
				if (!this.currentToken.literal) {
					throw new BconfError("unexpected empty variable name", this.currentToken);
				}

				const key = await this.parseKey(args);
				if (args.varAsKeyPath) {
					return key;
				}

				const variable = this.currentScope.resolve(key);
				if (!variable.found) {
					throw new BconfError(
						`could not resolve variable '${key.serialize()}'`,
						this.currentToken,
					);
				}

				return variable.value;
			}
			default:
				throw new BconfError(
					`unexpected value '${this.currentToken.literal}'`,
					this.currentToken,
				);
		}
	}

	/**
	 * @param {string} stopToken
	 * @param {Record<string, Value>} root
	 * @param {NextArgs} args
	 */
	async parseBlock(stopToken, root, args) {
		const isNotRoot = stopToken === TokenType.RBRACE;
		if (isNotRoot) {
			this.currentScope = new Scope(this.currentScope);
		}

		while (this.currentToken.type !== stopToken && this.currentToken.type !== TokenType.EOF) {
			// Skip newlines used for formatting
			while (this.currentToken.type === TokenType.NEWLINE) {
				this.advance();
			}

			// Guarding against cases where its just lots of empty newlines at the end of the file
			if (this.currentToken.type === TokenType.EOF || this.currentToken.type === stopToken) {
				break;
			}

			const parsedKey = await this.parseKey(args);
			const lastKey = parsedKey.parts[parsedKey.parts.length - 1];
			const keyToUse = lastKey.type === "index" ? lastKey.index : lastKey.key;

			let rootToUse = root;
			if (parsedKey.parts[0].type === "variable") {
				rootToUse = args.treatVarsAsKeys ? root : this.currentScope.variables;
			}

			const operator = this.parseOperator(stopToken);
			const parent = getParentForKey(rootToUse, parsedKey);
			const isDuplicateKey = lastKey.type !== "index" && Object.hasOwn(parent, keyToUse);
			if (isDuplicateKey && args.duplicateKeys === "disallow") {
				throw new BconfError("cannot have duplicate keys", this.currentToken);
			}

			switch (operator) {
				case "assign":
				case "object-shorthand":
				case "true-shorthand": {
					const value =
						operator === "true-shorthand" ? true : await this.parseValue(args);

					if (isDuplicateKey && args.duplicateKeys === "collect") {
						const collection = createCollection(keyToUse, parent);
						collection.add(value);
					} else {
						parent[keyToUse] = value;
					}

					break;
				}
				case "append": {
					let targetArray = parent[keyToUse];

					if (isDuplicateKey && args.duplicateKeys === "collect") {
						const collection = createCollection(keyToUse, parent);
						if (Array.isArray(collection.last)) {
							targetArray = collection.last;
						} else {
							targetArray = [];
							collection.add(targetArray);
						}
					} else if (!Array.isArray(targetArray)) {
						targetArray = [];
						parent[keyToUse] = targetArray;
					}

					targetArray.push(await this.parseValue(args));
					break;
				}
				case "statement": {
					const resolved = await this.resolveStatement(parsedKey, args, stopToken);
					// This accounts for scenarios where there is no resolver, so values
					// are collected, or a resolver does not get all the values in the statement.
					// For the latter, they are simply discarded
					const remainingValues = await this.parseStatementArgs(args, stopToken);
					switch (resolved.action) {
						case "collect": {
							let targetStatement = parent[keyToUse];

							if (isDuplicateKey && args.duplicateKeys === "collect") {
								const collection = createCollection(keyToUse, parent);
								if (collection.last instanceof Statement) {
									targetStatement = collection.last;
								} else {
									targetStatement = new Statement(parsedKey, []);
									collection.add(targetStatement);
								}
							} else if (!(targetStatement instanceof Statement)) {
								targetStatement = new Statement(parsedKey, []);
								parent[keyToUse] = targetStatement;
							}

							targetStatement.args.push(
								resolved.value !== undefined ? [resolved.value] : remainingValues,
							);

							break;
						}
						case "merge": {
							if (!isObject(resolved.value)) {
								throw new BconfError(
									"cannot merge non object values into current document when resolving statement",
									this.currentToken,
								);
							}
							deepMerge(root, resolved.value);
							break;
						}
						// Nothing to do if the action is "discard"
						case "discard":
							break;
					}
					break;
				}
			}

			if (this.currentToken.type === TokenType.COMMA) {
				if (isNotRoot) {
					this.advance();
				} else {
					throw new BconfError(
						"commas are only allowed in objects and arrays",
						this.currentToken,
					);
				}
			}
		}

		this.currentScope = this.currentScope.parent ?? this.rootScope;
	}

	/**
	 * @returns {Promise<ParseResult>}
	 */
	async parse() {
		await this.parseBlock(TokenType.EOF, this.result, {});
		return {
			data: /** @type {ParseResult['data']} */ (
				this.opts.unwrap ? unwrap(this.result) : this.result
			),
			variables: /** @type {ParseResult['data']} */ (
				this.opts.unwrap ? unwrap(this.exportedVariables) : this.exportedVariables
			),
		};
	}
}

/**
 * @param {string | number} key
 * @param {Container} container
 * @returns {Collection}
 */
export function createCollection(key, container) {
	let collectionToUse = container[key];
	if (!(collectionToUse instanceof Collection)) {
		collectionToUse = new Collection([container[key]]);
		container[key] = collectionToUse;
	}

	return collectionToUse;
}
