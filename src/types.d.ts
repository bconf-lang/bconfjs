import type { KeyPath, Tag, Statement, Collection } from "./values.js";

export type Value =
	| Statement
	| Tag
	| Collection
	| KeyPath
	| { [key: string]: Value }
	| Value[]
	| SerializableValue;

export type SerializableValue = string | number | null | boolean;

export type ParseOptions = {
	/**
	 * Resolvers to use for tags/statements
	 */
	resolvers?: {
		/**
		 * Resolvers for tags
		 */
		tags?: Array<{ name: string; resolver: TagResolver }>;
		/**
		 * Resolvers for statements
		 */
		statements?: Array<{ name: string; resolver: StatementResolver }>;
	};
	/**
	 * Variables to inject at the root of the file when parsing.
	 * NOTE: These are treated like regular variables and can be overwritten
	 */
	variables?: Record<string, Value>;
	/**
	 * Environment variables to use. This defaults to `process.env` for
	 * non-browser environments, and `window` for browsers
	 */
	env?: Record<string, unknown>;
	/**
	 * The root directory
	 */
	rootDir?: string;
	/**
	 * The URL of the file that is being parsed
	 */
	file?: URL;
	/**
	 * A custom loader to load files. This defaults to reading
	 * files on disk in non-browser environments, and using `fetch`
	 * for browser environments
	 */
	loader?: FileLoader;
	/**
	 * If the parsed results should unwrap internal types into their
	 * native types. For example, an unresolved tag like `custom_tag(123)`
	 * is internally stored as a `Tag` class which is then unwrapped
	 * into `["custom_tag", 123]` at the end
	 *
	 * This is useful for implementing custom logic which may require
	 * the full file to be parsed
	 *
	 * @default true
	 */
	unwrap?: boolean;
};

export type ParseResult<T extends Value = SerializableValue> = {
	/**
	 * The resolved data for the input
	 */
	data: Record<string, T>;
	/**
	 * Exported variables for the input
	 */
	variables: Record<string, T>;
};

export type TagResolver = (context: ResolverContext) => Promise<Value>;
export type StatementResolver = (context: ResolverContext) => Promise<StatementAction>;
export type FileLoader = (
	rootDir: string,
	path: string,
	args?: FileLoaderArgs,
) => Promise<string> | string;

export type ResolverContext = {
	/**
	 * The environment variables provided to the parser
	 */
	env: Record<string, unknown>;
	/**
	 * What lexical scope the resolver is being called in. If the value
	 * is `root`, it is parsing the top level values. If it is `object`
	 * it is parsing an object created with `{}`. Nested keys will inherit
	 * the scope of its parent
	 *
	 * eg. `foo.bar.baz` at the top level will have a scope of `root` since
	 * the object/nested values are not being created with `{}`
	 */
	scope: "root" | "object";
	/**
	 * The current file that is loaded
	 */
	file?: URL;
	/**
	 * Methods related to variables within the document
	 */
	variables: {
		/**
		 * Get the variable with the given name
		 */
		get: (name: string | KeyPath) => { found: true; value: Value } | { found: false };
		/**
		 * Add a variable to the current document with the given name. This method will
		 * return false if the variable could not be set, such as if the variable is already
		 * defined, does not start with `$`, etc.
		 *
		 * NOTE: Dotted keys and array indexes are not supported, only bare keys like `$foo`
		 * are allowed. If you want to merge/add values nested in a variable, you must implement
		 * that logic yourself
		 */
		set: (name: string, value: Value, args?: SetVariableArgs) => boolean;
	};
	/**
	 * Load the file at the given path. This will use the file loader
	 * provided to the parser and return its raw content
	 */
	loadFile: (path: string, args?: FileLoaderArgs) => Promise<string> | string;
	/**
	 * What the current arguments are for parsing values
	 */
	nextArgs: NextArgs;
	/**
	 * Get the next value for the type being resolved. For tags, this
	 * will return the values within the parenthesis, and for statements,
	 * this will return values until the end of the line
	 *
	 * Resolvers are not required to read all values in the tag/statement,
	 * but any unread values will be discarded
	 *
	 * If `success` is false, there are no more values to values to read
	 * (ie. it has reached the end of the tag/statement)
	 */
	next: (
		args?: NextArgs,
	) => Promise<{ success: true; value: Value | KeyPath } | { success: false }>;
	/**
	 * Look up a value for the given path within the current document being parsed
	 */
	lookup: (path: KeyPath) => { success: true; value: Value } | { success: false };
	/**
	 * Parse the given input. This input will be parsed with the same options
	 * provided to the parser
	 */
	parse: <TOptions extends ParseOptions>(
		input: string,
		opts?: TOptions,
	) => Promise<ParseResult<TOptions["unwrap"] extends true ? SerializableValue : Value>>;
};

export type SetVariableArgs = {
	/**
	 * The scope to add the variable to. If the scope is `current`,
	 * the variable will only be added to the current scope of the block
	 * being parsed (including if it is at the root). If the scope if
	 * `root`, it will be added to the root level
	 *
	 * @default "current"
	 */
	scope?: "current" | "root";
	/**
	 * Whether or not this value should override any existing value.
	 *
	 * @default false
	 */
	override?: boolean;
	/**
	 * If the variable should be exported or not. Exported variables
	 * will also be added within the current document. To only export
	 * a variable without adding it to the current document, `exportOnly`
	 * must be set
	 *
	 * @default false
	 */
	export?: boolean;
	/**
	 * If `true`, this will only export the variable and not add it
	 * to the current document. This must be set with `export`, otherwise
	 * nothing will happen
	 *
	 * @default false
	 */
	exportOnly?: boolean;
};

export type FileLoaderArgs = {
	/**
	 * Time in milliseconds for how long the file loader
	 * should attempt to read the file. Default is 15 seconds
	 *
	 * @default 15000
	 */
	timeoutMS?: number;
	/**
	 * The abort controller to use to cancel reading the file
	 */
	controller?: AbortController;
	/**
	 * Options for `fetch` if the file loader requires it
	 */
	fetch?: Omit<RequestInit, "signal">;
};

export type NextArgs = {
	/**
	 * If the value is a variable, return the `KeyPath` instead. For example,
	 * `foo = $bar` would return the key path `$bar` instead of the value of
	 * the variable. This also includes dotted keys and array indexes
	 *
	 * @default false
	 */
	varAsKeyPath?: boolean;
	/**
	 * Whether or not variable assignments should be treated as regular key-value
	 * pairs and a part of the output for the block. This is useful for
	 */
	treatVarsAsKeys?: boolean;
	/**
	 * Define how duplicate keys for key-value pairs and variable assignments
	 * should be handled when encountered
	 *
	 * - `"override"` - overrides the existing value
	 * - `"collect"` - collect values with duplicate keys into a `Collection`. If
	 * a `Collection` ends up in the final output, the last collected value will
	 * be used
	 * - `"disallow"` - if a duplicate key is encountered, throw an error
	 *
	 * This is only applicable scenarios where content will be overwritten, excluding
	 * operations on array indexes. For example:
	 * ```bconf
	 * foo.bar = 123
	 * foo.bar << 456 // Will overwrite what already exists at `foo.bar`
	 * foo = 321 // Will overwrite what already exists at `foo`
	 * foo[0] = 654 // NOT considered a duplicate key
	 * ```
	 *
	 * @default "override"
	 */
	duplicateKeys?: "override" | "collect" | "disallow";
	/**
	 * How identifiers should should be treated when encountered as a value
	 *
	 * - `"keypath"` - parse it as a valid value, returning a `KeyPath`
	 * - `"literal"` - returns the literal value of the first identifier. This
	 * does not include dotted keys or array indexes (eg. `foo[0].bar`, only `foo`
	 * will be returned)
	 * - `"disallow"` - if an identifier is encountered as a value, throw an error
	 *
	 * @default "disallow"
	 */
	identifiersAsValue?: "keypath" | "literal" | "disallow";
};

export type StatementAction =
	| {
			/**
			 * Does not include the statement or its values in the output
			 * of the parsed document
			 */
			action: "discard";
	  }
	| {
			/**
			 * Merge the provided value with the current document in its
			 * current state. This will discard the original statement and its
			 * values in the output of the parsed document
			 */
			action: "merge";
			/**
			 * The data to be merged with the current document
			 */
			value: Record<string, Value>;
	  }
	| {
			/**
			 * Include the statement in the output of the parsed document. This
			 * is the default behaviour for statements that do not have a resolver.
			 * If no `value` is defined, the default behaviour for statements is
			 * used (ie. collect all values in the statement into an array)
			 */
			action: "collect";
			/**
			 * The value to be appended to the statement key. If this is not defined,
			 * all values in the statement will be collected into an array and appended
			 */
			value?: Value;
	  };

export type Key =
	| {
			type: "alphanumeric" | "string" | "variable";
			key: string;
	  }
	| {
			type: "index";
			index: number;
	  };

export type Operation = "append" | "assign" | "object-shorthand" | "true-shorthand" | "statement";

export type ParsedNumber = {
	type: "integer" | "float";
	value: number;
};

// Represents a node in the config tree that can hold children.
// Essentially its a union of an array and object, but typed to allow flexible access.
export type Container = Record<string | number, Value>;
