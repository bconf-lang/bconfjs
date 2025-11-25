/**
 * @import { Key, Operation, ParsedNumber, Value, NextArgs, ResolverContext, StatementResolver, TagResolver, ParseOptions, FileLoader, StatementAction, Container } from './types.js'
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
 * @param {string} input Input bconf file
 * @param {ParseOptions=} opts Options for parsing
 */
export function parse(input, opts) {
	const parser = new Parser(input, opts);
	return parser.parse();
}

const browser = typeof window !== "undefined";
const defaultLoader = await (browser ? import("./browser/files.js") : import("./node/files.js"));

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
	/** @type {Array<Token>} */ tokens;
	/** @type {Token} */ currToken;
	/** @type {number} */ pos;
	/** @type {Record<string, Value>} */ result = {};
	/** @type {Scope} */ rootScope = new Scope(null);
	/** @type {Scope} */ currentScope = this.rootScope;

	/** @type {Map<string, StatementResolver>} */ statementResolvers = new Map(
		BUILT_IN_STATEMENT_RESOLVERS,
	);
	/** @type {Map<string, TagResolver>} */ tagResolvers = new Map(BUILT_IN_TAG_RESOLVERS);
	env = /** @type {Record<string, unknown>} */ (browser ? window : process.env);
	/** @type {Record<string, Value>} */ exportedVariables = {};
	/** @type {FileLoader} */ fileLoader = defaultLoader.resolveFile;
	/** @type {string} */ rootFilePath = browser ? "/" : import.meta.dirname;

	/** @type {NextArgs} */ nextValueParsingOpts = {};

	/**
	 * @param {string} input The file to parse
	 * @param {ParseOptions=} opts Options for parsing
	 */
	constructor(input, opts) {
		if (opts?.env) {
			this.env = opts.env;
		}

		if (opts?.resolvers?.tags) {
			for (const tag of opts.resolvers.tags) {
				this.tagResolvers.set(tag.name, tag.resolver);
			}
		}

		if (opts?.resolvers?.statements) {
			for (const statement of opts.resolvers.statements) {
				this.statementResolvers.set(statement.name, statement.resolver);
			}
		}

		if (opts?.rootDir) {
			this.rootFilePath = opts.rootDir;
		}

		if (opts?.loader) {
			this.fileLoader = opts.loader;
		}

		this.pos = 0;
		this.tokens = tokenize(input).filter(
			(t) => t.type !== TokenType.COMMENT && t.type !== TokenType.WHITESPACE,
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

	advance() {
		this.currToken = this.peek();
		this.pos++;
	}

	isTag() {
		return (
			this.currToken.type === TokenType.IDENTIFIER &&
			!this.currToken.literal?.includes("+") &&
			this.peek().type === TokenType.LPAREN
		);
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Key>}
	 */
	async parseKeyPart(args) {
		if (!this.currToken.literal) {
			throw new BconfError("expected a valid key but got an empty literal", this.currToken);
		}

		if (this.currToken.type === TokenType.DOT) {
			this.advance();
		}

		switch (this.currToken.type) {
			case TokenType.VARIABLE: {
				/** @type {Key} */
				const key = { type: "variable", key: this.currToken.literal };
				this.advance();
				return key;
			}
			case TokenType.IDENTIFIER: {
				if (this.currToken.literal.includes("+")) {
					throw new BconfError("invalid key", this.currToken);
				}
				/** @type {Key} */
				const key = { type: "alphanumeric", key: this.currToken.literal };
				this.advance();
				return key;
			}
			case TokenType.DOUBLE_QUOTE: {
				const value = await this.parseString(args);
				if (!value) {
					throw new BconfError("unexpected empty key part", this.currToken);
				}

				return { type: "alphanumeric", key: value };
			}
			case TokenType.INDEX_LBRACKET: {
				this.advance(); // Consume `[`
				if (this.currToken.type !== TokenType.IDENTIFIER) {
					throw new BconfError("expected number for array index", this.currToken);
				}

				const index = this.parseNumber();
				if (index.type === "float") {
					throw new BconfError("expected array index to be an integer", this.currToken);
				}

				if (index.value < 0) {
					throw new BconfError(
						"expected non-negative integer for array index",
						this.currToken,
					);
				}

				if (this.currToken.type !== TokenType.RBRACKET) {
					throw new BconfError("expected ']'", this.currToken);
				}

				this.advance(); // Consume `]`
				return { type: "index", index: index.value };
			}
			default:
				throw new BconfError("expected key", this.currToken);
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
			this.currToken.type === TokenType.DOT ||
			this.currToken.type === TokenType.INDEX_LBRACKET
		) {
			const key = await this.parseKeyPart(args);

			// Variable keys can only be the first key
			if (key.type === "variable") {
				throw new BconfError("unexpected variable key in key sequence", this.currToken);
			}

			path.addKey(key);
		}

		return path;
	}

	/**
	 * @param {string} stopToken
	 * @returns {Operation}
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
			// This accounts for trailing commas in objects like `{foo,}`
			case TokenType.COMMA:
				if (stopToken === TokenType.EOF) {
					throw new BconfError("unexpected end of data", this.currToken);
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
					`unexpected operator '${this.currToken.literal}'`,
					this.currToken,
				);
		}
	}

	/**
	 * @param {string} stopToken
	 * @param {NextArgs} args
	 * @param {"statement" | "tag"} type
	 * @returns {ResolverContext}
	 */
	createResolverContext(stopToken, args, type) {
		return {
			// TODO
			file: new URL("file://url"),
			env: this.env,
			loadFile: (path, args) => this.fileLoader(this.rootFilePath, path, args),
			scope: this.currentScope === this.rootScope ? "root" : "object",
			nextArgs: args,
			next: async (newArgs) => {
				if (
					this.currToken.type === stopToken ||
					this.currToken.type === TokenType.NEWLINE ||
					this.currToken.type === TokenType.EOF ||
					this.currToken.type === TokenType.COMMA
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
			parse: async (input) => {
				const parser = new Parser(input);
				await parser.parse();
				return { data: parser.result, variables: parser.exportedVariables };
			},
		};
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Value>}
	 */
	async resolveTag(args) {
		if (!this.currToken.literal) {
			throw new BconfError("unexpected empty tag name", this.currToken);
		}

		const tagName = this.currToken.literal;
		this.advance(); // Consume tag name

		if (this.currToken.type !== TokenType.LPAREN) {
			throw new BconfError(`expected '(', got '${this.currToken.literal}'`, this.currToken);
		}
		this.advance(); // Consume `(`

		/** @type {NextArgs} */
		const newArgs = { ...args, identifiersAsValue: "keypath" };
		/** @type {Value} */
		let value;
		const resolver = this.tagResolvers.get(tagName);
		if (resolver) {
			try {
				value = await resolver(
					this.createResolverContext(TokenType.RPAREN, newArgs, "tag"),
				);
			} catch (error) {
				if (error instanceof Error) {
					throw new BconfError(error.message, this.currToken);
				}

				throw new BconfError("unexpected error when resolving tag", this.currToken);
			}
		} else {
			value = await this.parseValue(newArgs);
		}

		if (this.currToken.type !== TokenType.RPAREN) {
			throw new BconfError(`expected ')', got '${this.currToken.type}'`, this.currToken);
		}

		this.advance(); // Consume `)`
		return resolver ? value : new Tag(tagName, value);
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Value>}
	 */
	async parseStatementValue(args) {
		// Enforcing that statements strictly follow what is allowed in a statement
		// so there is no ambiguity between what some statement resolvers allow, and
		// what others don't
		if (this.currToken.type === TokenType.IDENTIFIER) {
			const value = await this.parseValue({ ...args, identifiersAsValue: "literal" });
			if (this.currToken.type === TokenType.DOT) {
				throw new BconfError("dotted keys are not allowed in statements", this.currToken);
			}
			if (this.currToken.type === TokenType.INDEX_LBRACKET) {
				throw new BconfError("array indexes are not allowed in statements", this.currToken);
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
			this.currToken.type !== TokenType.NEWLINE &&
			this.currToken.type !== TokenType.EOF &&
			this.currToken.type !== stopToken &&
			// Ensuring that controls is always handed back to parseBlock to determine
			// how the comma should be handled (throw or consume)
			this.currToken.type !== TokenType.COMMA
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
				this.currToken,
			);
		}

		const resolver = this.statementResolvers.get(key.parts[0].key);
		if (!resolver) {
			return { action: "collect" };
		}

		try {
			return await resolver(this.createResolverContext(stopToken, args, "statement"));
		} catch (error) {
			if (error instanceof Error) {
				throw new BconfError(error.message, this.currToken);
			}

			throw new BconfError("unexpected error while resolving statement", this.currToken);
		}
	}

	/**
	 * @returns {ParsedNumber}
	 */
	parseNumber() {
		if (this.currToken.type !== TokenType.IDENTIFIER) {
			throw new BconfError(
				`expected number but got '${this.currToken.literal}'`,
				this.currToken,
			);
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
				throw new BconfError("unterminated float", this.currToken);
			}

			resolvedNumber += this.currToken.literal ?? "";
			this.advance();
		}

		try {
			const value = validateAndParseNumber(resolvedNumber);
			return { type, value };
		} catch (error) {
			if (error instanceof Error) {
				throw new BconfError(error.message, this.currToken);
			}

			throw new BconfError(`could not parse number: ${error}`, this.currToken);
		}
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<string>}
	 */
	async parseEmbeddedValue(args) {
		this.advance(); // Consume `${`

		if (!this.currToken.literal) {
			throw new BconfError(
				`expected expression, got '${this.currToken.literal}'`,
				this.currToken,
			);
		}

		/** @type {string} */
		let value;
		switch (this.currToken.type) {
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
						this.currToken,
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
						this.currToken,
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
							this.currToken,
						);
					}

					value = String(parsed);
				} else {
					value = String(this.parseNumber().value);
				}
				break;
			case TokenType.NULL:
			case TokenType.BOOLEAN:
				value = this.currToken.literal;
				this.advance();
				break;
			default:
				throw new BconfError(
					"only primitive values are allowed in embedded values",
					this.currToken,
				);
		}

		if (this.currToken.type !== TokenType.RBRACE) {
			throw new BconfError(`expected '}', got '${this.currToken.literal}'`, this.currToken);
		}

		this.advance(); // Consume `}`
		return value;
	}

	parseEscapedValue() {
		if (!this.currToken.literal) {
			throw new BconfError("unexpected empty value", this.currToken);
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
			case "U": {
				const codePoint = parseInt(this.currToken.literal.substring(2), 16);
				if (Number.isNaN(codePoint)) {
					throw new BconfError("invalid escaped unicode code point", this.currToken);
				}

				try {
					return String.fromCodePoint(codePoint);
				} catch {
					throw new BconfError("invalid escaped unicode code point", this.currToken);
				}
			}

			default:
				throw new BconfError(
					`invalid escape sequence '${this.currToken.literal}'`,
					this.currToken,
				);
		}
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<string>}
	 */
	async parseString(args) {
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
					resolved += await this.parseEmbeddedValue(args);
					break;
				case TokenType.ESCAPE_SEQUENCE:
					resolved += this.parseEscapedValue();
					this.advance();
					break;
				default:
					throw new BconfError("unexpected value in string", this.currToken);
			}
		}

		if (this.currToken.type !== boundary) {
			throw new BconfError(
				`expected ${boundary}, got ${this.currToken.literal}`,
				this.currToken,
			);
		}

		this.advance(); // Consume `"` or `"""`
		return resolved;
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Record<string, Value>>}
	 */
	async parseObject(args) {
		this.advance(); // Consume `{`

		/** @type {Record<string, Value>} */
		const obj = {};
		await this.parseBlock(TokenType.RBRACE, obj, args);
		if (this.currToken.type !== TokenType.RBRACE) {
			throw new BconfError(`expected '}', got ${this.currToken.literal}`, this.currToken);
		}

		this.advance(); // Consume `}`
		return obj;
	}

	/**
	 * @param {NextArgs} args
	 * @returns {Promise<Array<Value>>}
	 */
	async parseArray(args) {
		this.advance(); // Consume `[`

		/** @type {Array<Value>} */
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

			arr.push(await this.parseValue(args));

			if (this.currToken.type === TokenType.COMMA) {
				this.advance();
			}
		}

		if (this.currToken.type !== TokenType.RBRACKET) {
			throw new BconfError(`expected ']', got ${this.currToken.literal}`, this.currToken);
		}

		this.advance(); // Consume `]`
		return arr;
	}

	/**
	 * Get the next value until the stop token
	 * @param {NextArgs} args
	 * @returns {Promise<Value>}
	 */
	async parseValue(args) {
		switch (this.currToken.type) {
			case TokenType.IDENTIFIER: {
				if (this.isTag()) {
					return await this.resolveTag(args);
				}

				if (looksLikeNumber(this.currToken)) {
					return this.parseNumber().value;
				}

				if (args.identifiersAsValue === "keypath") {
					return await this.parseKey(args);
				}

				if (args.identifiersAsValue === "literal") {
					const value = this.currToken.literal;
					this.advance();
					return value;
				}

				throw new BconfError(
					`unexpected identifier as value '${this.currToken.literal}'`,
					this.currToken,
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
				return await this.parseObject(args);
			case TokenType.LBRACKET:
				return await this.parseArray(args);
			case TokenType.DOUBLE_QUOTE:
			case TokenType.TRIPLE_QUOTE:
				return await this.parseString(args);
			case TokenType.VARIABLE: {
				if (!this.currToken.literal) {
					throw new BconfError("unexpected empty variable name", this.currToken);
				}

				const key = await this.parseKey(args);
				if (args.varAsKeyPath) {
					return key;
				}

				const variable = this.currentScope.resolve(key);
				if (!variable.found) {
					throw new BconfError(
						`could not resolve variable '${key.serialize()}'`,
						this.currToken,
					);
				}

				return variable.value;
			}
			default:
				throw new BconfError(
					`unexpected value '${this.currToken.literal}'`,
					this.currToken,
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

		while (this.currToken.type !== stopToken && this.currToken.type !== TokenType.EOF) {
			// Skip newlines used for formatting
			while (this.currToken.type === TokenType.NEWLINE) {
				this.advance();
			}

			// Guarding against cases where its just lots of empty newlines at the end of the file
			if (this.currToken.type === TokenType.EOF || this.currToken.type === stopToken) {
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
				throw new BconfError("cannot have duplicate keys", this.currToken);
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
									this.currToken,
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

			if (this.currToken.type === TokenType.COMMA) {
				if (isNotRoot) {
					this.advance();
				} else {
					throw new BconfError(
						"commas are only allowed in objects and arrays",
						this.currToken,
					);
				}
			}
		}

		this.currentScope = this.currentScope.parent ?? this.rootScope;
	}

	/**
	 * @returns {Promise<Record<string, unknown>>}
	 */
	async parse() {
		await this.parseBlock(TokenType.EOF, this.result, {});
		return /** @type {Record<string, unknown>} */ (unwrap(this.result));
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
