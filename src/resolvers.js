/**
 * @import { Value, TagResolver, StatementResolver, ResolverContext } from './index.js'
 */

import { isObject, validateAndParseNumber } from "./utils.js";
import { Collection, KeyPath, Statement } from "./values.js";

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
async function refResolver({ lookup, next }) {
	const nextValue = await next();
	if (
		!nextValue.success ||
		(!(nextValue.value instanceof KeyPath) && typeof nextValue.value !== "number")
	) {
		throw new Error("expected key path for 'ref' tag");
	}

	const resolvedValue = lookup(
		typeof nextValue.value === "number"
			? new KeyPath([{ type: "alphanumeric", key: String(nextValue.value) }])
			: nextValue.value,
	);
	if (!resolvedValue.success) {
		throw new Error(
			`no value exists at key '${typeof nextValue.value === "number" ? nextValue.value : nextValue.value.serialize()}'`,
		);
	}

	return resolvedValue.value;
}

/** @type {TagResolver} */
async function envResolver({ env, next }) {
	const nextValue = await next();
	if (!nextValue.success || typeof nextValue.value !== "string") {
		throw new Error("expected a string value for 'env' tag");
	}

	const envVariable = env[nextValue.value];
	if (envVariable === undefined) {
		throw new Error(`no environment variable '${nextValue.value}' is set`);
	}

	// Typecasting should be fine here - if a bad value is passed (ie. non-serializable value)
	// then the actual parsing logic should fail
	return /** @type {Value} */ (envVariable);
}

/** @type {TagResolver} */
async function stringResolver({ next }) {
	const nextValue = await next();
	if (!nextValue.success) {
		throw new Error("expected a value for 'string' tag");
	}

	const { value } = nextValue;
	if (typeof value === "string") {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean" || value === null) {
		return String(value);
	}

	throw new Error("cannot convert value to string");
}

/** @type {TagResolver} */
async function numberResolver({ next }) {
	const nextValue = await next();
	if (!nextValue.success) {
		throw new Error("expected value for 'number' tag");
	}

	const { value } = nextValue;
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

	throw new Error("cannot convert value to number");
}

/** @type {TagResolver} */
async function intResolver({ next }) {
	const nextValue = await next();
	if (!nextValue.success) {
		throw new Error("expected value for 'int' tag");
	}

	let { value } = nextValue;
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

	throw new Error("cannot convert value to integer");
}

/** @type {TagResolver} */
async function floatResolver({ next }) {
	const nextValue = await next();
	if (!nextValue.success) {
		throw new Error("expected value for 'int' tag");
	}

	const { value } = nextValue;
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

	throw new Error("cannot convert value to float");
}

/** @type {TagResolver} */
async function boolResolver({ next }) {
	const nextValue = await next();
	if (!nextValue.success) {
		throw new Error("expected value for 'int' tag");
	}

	const { value } = nextValue;
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

	throw new Error("cannot convert value to boolean");
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
async function importResolver(context) {
	const fromVal = await context.next();
	if (!fromVal.success) {
		throw new Error(
			`expected 'from' to be the second argument in import statements but got nothing`,
		);
	}

	if (fromVal.value !== "from") {
		throw new Error(
			`expected 'from' to be the second argument in import statements but got '${fromVal.value}'`,
		);
	}

	const filePath = await context.next();
	if (!filePath.success || typeof filePath.value !== "string") {
		throw new Error("file path must be a string in import statements");
	}
	if (!filePath.value) {
		throw new Error("file path cannot be empty in import statements");
	}

	const file = await context.loadFile(filePath.value);
	// TODO: Cache resolved values/variables to avoid parsing every time
	const { variables } = await context.parse(file);

	const instructions = await context.next({
		treatVarsAsKeys: true,
		varAsKeyPath: true,
		duplicateKeys: "collect",
	});
	if (!instructions.success || !isObject(instructions.value)) {
		throw new Error("expected object with variables to import");
	}

	for (const [name, instruction] of Object.entries(instructions.value)) {
		if (!name.startsWith("$") || instruction === false) {
			continue;
		}

		if (!(name in variables)) {
			throw new Error(`variable '${name}' is not exported from '${filePath}'`);
		}

		if (instruction instanceof Collection) {
			for (const value of instruction.collected) {
				handleImportInstruction(name, value, context, variables);
			}
		} else {
			handleImportInstruction(name, instruction, context, variables);
		}
	}

	return { action: "discard" };
}

/**
 * @param {string} name
 * @param {Value} instruction
 * @param {ResolverContext} context
 * @param {Record<string, Value>} variables
 */
function handleImportInstruction(name, instruction, context, variables) {
	if (instruction instanceof Statement) {
		// Supporting multiple aliases for the same variable
		// (eg. { $foo as $bar, $foo as $baz })
		for (const [asArg, key] of instruction.args) {
			if (typeof asArg !== "string" || asArg !== "as") {
				throw new Error(`expected 'as' for alias statement, got '${asArg}'`);
			}

			if (!(key instanceof KeyPath)) {
				throw new Error(`expected alias to be a key path, got '${typeof key}'`);
			}

			const [alias] = key.parts;
			if (alias.type !== "variable") {
				throw new Error(`expected variable key, got ${alias.type}`);
			}
			if (!alias.key.startsWith("$")) {
				throw new Error(`invalid alias name '${alias.key}', must follow variable syntax`);
			}

			if (context.variables.get(alias.key).found) {
				throw new Error(
					`variable '${alias.key}' cannot be imported as it has already been declared`,
				);
			}

			const success = context.variables.set(alias.key, variables[name]);
			if (!success) {
				throw new Error(`unexpectedly could not declare variable alias '${alias}'`);
			}
		}
	} else {
		const success = context.variables.set(name, variables[name]);
		if (!success) {
			throw new Error(`unexpectedly could not declare variable '${name}'`);
		}
	}
}

/**
 * @type {StatementResolver}
 */
async function exportResolver(context) {
	const varsValue = await context.next();
	if (!varsValue.success) {
		throw new Error(
			`expected 'vars' to be the second argument in export statements but got nothing`,
		);
	}

	if (varsValue.value !== "vars") {
		throw new Error(
			`expected 'vars' to be the second argument in export statements but got '${varsValue.value}'`,
		);
	}

	const variables = await context.next({
		treatVarsAsKeys: true,
		varAsKeyPath: true,
		duplicateKeys: "collect",
	});
	if (!variables.success || !isObject(variables.value)) {
		throw new Error("expected object with variables to export");
	}

	for (const [name, instruction] of Object.entries(variables.value)) {
		if (!name.startsWith("$")) {
			continue;
		}

		if (instruction instanceof Collection) {
			for (const value of instruction.collected) {
				handleExportInstruction(name, value, context);
			}
		} else {
			handleExportInstruction(name, instruction, context);
		}
	}

	return { action: "discard" };
}

/**
 * @param {string} name
 * @param {Value} instruction
 * @param {ResolverContext} context
 */
function handleExportInstruction(name, instruction, context) {
	if (instruction instanceof Statement) {
		// Supporting multiple aliases for the same variable
		// (eg. { $foo as $bar, $foo as $baz })
		for (const [asArg, key] of instruction.args) {
			if (typeof asArg !== "string" || asArg !== "as") {
				throw new Error(`expected 'as' for alias statement, got '${asArg}'`);
			}

			if (!(key instanceof KeyPath)) {
				throw new Error(`expected alias to be a key path, got '${typeof key}'`);
			}

			const [alias] = key.parts;
			if (alias.type !== "variable") {
				throw new Error(`expected variable key, got ${alias.type}`);
			}
			if (!alias.key.startsWith("$")) {
				throw new Error(`invalid alias name '${alias.key}', must follow variable syntax`);
			}

			const resolvedVariable = context.variables.get(name);
			// No variable with the name exists, its an inline declaration
			const value = resolvedVariable.found ? resolvedVariable.value : true;
			const success = context.variables.set(alias.key, value, {
				export: true,
				exportOnly: true,
			});
			if (!success) {
				throw new Error(`unexpectedly could not export variable '${alias.key}'`);
			}
		}
	} else {
		const resolvedVariable = context.variables.get(
			instruction instanceof KeyPath ? instruction : name,
		);
		// No variable with the name exists, its an inline declaration
		const value = resolvedVariable.found ? resolvedVariable.value : true;
		const success = context.variables.set(name, value, { export: true, exportOnly: true });
		if (!success) {
			throw new Error(`unexpectedly could not export variable '${name}'`);
		}
	}
}

/** @type {StatementResolver} */
async function extendsResolver(context) {
	const filePath = await context.next();
	if (!filePath.success || typeof filePath.value !== "string") {
		throw new Error("file path must be a string");
	}

	const file = await context.loadFile(filePath.value);
	const { data } = await context.parse(file);
	return { action: "merge", value: data };
}
