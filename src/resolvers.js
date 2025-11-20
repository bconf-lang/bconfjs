/**
 * @import { TagResolver } from './types.js'
 */

import { validateAndParseNumber } from "./utils.js";
import { KeyPath } from "./values.js";

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

	return envVariable;
}

/** @type {TagResolver} */
function stringResolver(value) {
	const type = typeof value;
	if (type === "string") {
		return value;
	}

	if (type === "number" || type === "boolean" || value === null) {
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
