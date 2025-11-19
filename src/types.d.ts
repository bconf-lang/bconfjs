export type TagResolver = (
	value: unknown,
	document: Record<string, unknown>,
	variables: Record<string, unknown>
) => any;

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
