/**
 * @import { TagResolver, StatementResolver, Value } from './types.js'
 */

import { isObject, validateAndParseNumber } from "./utils.js";
import { KeyPath, Statement } from "./values.js";

// -------------------------
// TAG RESOLVERS
// -------------------------
/** @type {Map<string, TagResolver>} */
export const BUILT_IN_TAG_RESOLVERS = new Map([
	["ref", refResolver],
	["env", envResolver],
	["string", stringResolver],
	["number", numberResolver],
	["int", intResolver],
	["float", floatResolver],
	["bool", boolResolver],
]);

/** @type {TagResolver} */
function refResolver(value, { resolve }) {
	if (!(value instanceof KeyPath)) {
		throw new Error("Key must be passed to ref tag");
	}

	const resolvedValue = resolve(value);
	if (resolvedValue === undefined) {
		throw new Error("No value at key path");
	}

	return resolvedValue;
}

/** @type {TagResolver} */
function envResolver(value, { env }) {
	if (typeof value !== "string") {
		throw new Error("Value in env resolver must be a string");
	}

	const envVariable = env[value];
	if (envVariable === undefined) {
		throw new Error("No environment variable set");
	}

	// Typecasting should be fine here - if a bad value is passed (ie. non-serializable value)
	// then the actual parsing logic should fail
	return /** @type {Value} */ (envVariable);
}

/** @type {TagResolver} */
function stringResolver(value) {
	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean" || value === null) {
		return String(value);
	}

	throw new Error("Cannot resolve value to string");
}

/** @type {TagResolver} */
function numberResolver(value) {
	if (typeof value === "number") {
		return value;
	}

	if (value === true) {
		return 1;
	}

	if (value === false || value === null) {
		return 0;
	}

	if (typeof value === "string") {
		return validateAndParseNumber(value);
	}

	throw new Error("Cannot convert value to number");
}

/** @type {TagResolver} */
function intResolver(value) {
	if (value === true) {
		return 1;
	}

	if (value === false || value === null) {
		return 0;
	}

	if (typeof value === "string") {
		value = validateAndParseNumber(value);
	}

	if (typeof value === "number") {
		return Number.isInteger(value) ? value : Math.trunc(value);
	}

	throw new Error("Cannot convert to integer");
}

/** @type {TagResolver} */
function floatResolver(value) {
	if (value === true) {
		return 1.0;
	}

	if (value === false || value === null) {
		return 0.0;
	}

	if (typeof value === "string") {
		// Spec says that integers should be converted to their exact floating point,
		// but thats not possible in JavaScript, so theres nothing to do other than the conversion
		return validateAndParseNumber(value);
	}

	if (typeof value === "number") {
		return value;
	}

	throw new Error("Cannot convert to integer");
}

/** @type {TagResolver} */
function boolResolver(value) {
	if (typeof value === "boolean") {
		return value;
	}

	if (value === null) {
		return false;
	}

	if (typeof value === "string") {
		return !!value;
	}

	if (typeof value === "number") {
		return value !== 0;
	}

	throw new Error("Cannot convert to boolean");
}

// -------------------------
// STATEMENT RESOLVERS
// -------------------------
/** @type {Map<string, StatementResolver>} */
export const BUILT_IN_STATEMENT_RESOLVERS = new Map([
	["import", importResolver],
	["export", exportResolver],
	["extends", extendsResolver],
]);

/** @type {StatementResolver} */
async function importResolver(args, context) {
	if (args[0] !== "from") {
		throw new Error('Must follow syntax `import from "path/to/file" { ... }`');
	}

	const filePath = args[1];
	if (typeof filePath !== "string") {
		throw new Error("File path must be a string");
	}
	if (!filePath) {
		throw new Error("Cannot have empty file path");
	}

	const file = await context.loadFile(filePath);
	// TODO: Cache resolved values/variables to avoid parsing every time
	const { variables } = await context.parse(file);

	const instructions = args[2];
	if (!isObject(instructions)) {
		throw new Error("Must have variables object");
	}

	for (const [name, instruction] of Object.entries(instructions)) {
		if (!name.startsWith("$") || instruction === false) {
			continue;
		}

		if (!(name in variables)) {
			throw new Error("Cannot import unexported variable");
		}

		if (context.getVariable(name).found) {
			throw new Error("Cannot import variable as it has already been declared");
		}

		if (instruction !== true && !(instruction instanceof Statement)) {
			throw new Error("Invalid import instruction");
		}

		if (instruction instanceof Statement) {
			// Supporting multiple aliases for the same variable
			// (eg. { $foo as $bar, $foo as $baz })
			for (const args of instruction.args) {
				if (args[0] !== "as") {
					throw new Error("Invalid alias statement");
				}

				const alias = args[1];
				if (typeof alias !== "string" || !alias.startsWith("$")) {
					throw new Error("Invalid alias name. Variables must start with $");
				}

				const success = context.declareVariable(alias, variables[name]);
				if (!success) {
					throw new Error("Could not declare aliased variable");
				}
			}
		} else {
			if (!(name in variables)) {
				throw new Error("Cannot import variable that is unexported");
			}

			const success = context.declareVariable(name, variables[name]);
			if (!success) {
				throw new Error("Could not declare variable");
			}
		}
	}

	return { action: "discard" };
}

/**
 * @type {StatementResolver}
 */
async function exportResolver(args, context) {
	if (args[0] !== "vars") {
		throw new Error("Must follow syntax `export vars { ... }`");
	}

	const variables = args[1];
	if (!isObject(variables)) {
		throw new Error("Must have object for exporting variables");
	}

	for (const [name, instruction] of Object.entries(variables)) {
		if (!name.startsWith("$")) {
			continue;
		}

		let value;
		if (instruction === true) {
			const resolvedVariable = context.getVariable(name);
			// No variable with the name exists, its an inline declaration
			value = resolvedVariable.found ? resolvedVariable.value : true;
		} else {
			// Inline declaration
			value = /** @type {Value} */ (instruction);
		}

		context.declareVariable(name, value, { export: true, exportOnly: true });
	}

	return { action: "discard" };
}

/** @type {StatementResolver} */
async function extendsResolver(args, context) {
	if (typeof args[0] !== "string") {
		throw new Error("Must have string as the argument");
	}

	const file = await context.loadFile(args[0]);
	const { data } = await context.parse(file);
	return { action: "merge", value: data };
}
