import type { KeyPath, Tag, Statement } from "./values.js";

export type Value =
	| Tag
	| Statement
	| string
	| number
	| null
	| boolean
	| Record<string, Value>
	| Array<Value>;

export type SerializableValue =
	| string
	| number
	| null
	| boolean
	| Record<string, SerializableValue>
	| Array<SerializableValue>;

export type TagResolver = (value: Value | KeyPath, args: TagResolverArgs) => Value;
export type TagResolverArgs = {
	// Resolve the value at the given key. If the returned value is
	// undefined, it does not exist
	resolve: (key: KeyPath) => undefined | Value;
	// Record of environment variables
	env: Record<string, unknown>;
};

export type StatementResolver = (
	args: Array<Value>,
	context: StatementResolverContext
) => Promise<StatementAction>;

export type StatementResolverContext = {
	// Record of environment variables
	env: Record<string, unknown>;
	// All variables currently parsed
	variables: { readonly [variable: string]: Value };
	// Load a file at the given path. This will return an empty string if no file
	// can be resolved at the path
	loadFile: (path: string, opts?: FileLoaderFetchOptions) => Promise<string>;
	// Add a variable to the document being parsed, returning false if the variable
	// could not be added for whatever reason
	declareVariable: (
		name: string,
		value: Value,
		args?: {
			// What scope the variable should be declared in. By default this is `current`
			scope?: "current" | "root";
			// Whether or not any existing variable should be overridden. The function
			// will return `false` if a variable already exists. Default is false
			override?: boolean;
			// If the variable should be exported. This will respect the `override` value
			export?: boolean;
			// If the variable should only be exported and not available to the current document.
			// Default `false`
			exportOnly?: boolean;
		}
	) => boolean;

	// Parse a given file
	parse: (input: string) => Promise<{
		// The resolved data of the file
		data: Record<string, Value>;
		// Variables exported from the file
		variables: Record<string, Value>;
	}>;
};

export type StatementAction = {
	action: "discard" | "merge" | "push";
	value?: Value;
};

export type ParseOptions = {
	// An array of custom tags to use when parsing the input
	tags?: Array<{
		name: string;
		resolver: TagResolver;
	}>;
	// An array of custom statement resolvers to use when parsing the input
	statements?: Array<{
		name: string;
		resolver: StatementResolver;
	}>;
	// Variables to inject when parsing
	variables?: Record<string, unknown>;
	// The object to look at for environment variables. By default,
	// this is `process.env` on non-browser environments and `window`
	// for browsers
	env?: Record<string, unknown>;
	// Root file path. For browsers, this is `/`, for non browsers
	// it is the current working directory
	root?: string;
	// A function to load files with for statements such as extends and import.
	// A default will be loaded based on the environment. For browsers, this will
	// fetch it based on the current url, and non browser environments
	// will read on the device
	fileLoader?: FileLoader;
};

export type FileLoader = (
	root: string,
	path: string,
	opts?: FileLoaderFetchOptions
) => Promise<string>;

export type FileLoaderFetchOptions = Omit<RequestInit, "signal"> & {
	// The abort controller to use
	controller?: AbortController;
	// Time in milliseconds for how long the fetch should occur
	timeout?: number;
};

export type KeyPart = {
	type: "alphanumeric" | "string" | "variable";
	key: string;
	// The array index number associated with this key
	index: number | null;
};

export type Operator = "append" | "assign" | "object-shorthand" | "true-shorthand" | "statement";

export type ParsedNumber = {
	type: "integer" | "float";
	value: number;
};

// Represents a node in the config tree that can hold children.
// Essentially its a union of an array and object, but typed to allow flexible access.
export type Container = Record<string | number, unknown>;
