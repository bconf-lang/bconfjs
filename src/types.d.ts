import type { KeyPath, Tag } from "./values.js";

export type Value =
	| KeyPath
	| Tag
	| string
	| number
	| null
	| boolean
	| Record<string, unknown>
	| Array<unknown>;

export type TagResolver = (value: Value, args: TagResolverArgs) => any;
export type TagResolverArgs = {
	// Resolve the value at the given key. If the returned value is
	// undefined, it does not exist
	resolve: (key: KeyPath) => undefined | unknown;
};

export type StatementResolver = (
	value: Array<unknown>,
	document: Record<string, unknown>,
	variables: Record<string, unknown>
) => {
	discard?: boolean;
	value?: any;
} | void;

export type ParseOptions = {
	// An array of custom tags to use when parsing the input
	tags?: Array<{
		name: string;
		resolver: TagResolver;
	}>;

	// Variables to inject when parsing
	variables?: Record<`$${string}`, unknown>;

	// The object to look at for environment variables. By default,
	// this is `process.env` on non-browser environments and `window`
	// for browsers
	env?: Record<string, unknown>;
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
