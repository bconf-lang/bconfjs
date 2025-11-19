/**
 * @import { TagResolver } from './types.js'
 */

/** @type {Map<string, TagResolver>} */
export const BUILT_IN_TAGS = new Map([
	["ref", refResolver],
	["env", envResolver],
	["string", stringResolver],
	["number", numberResolver],
	["int", intResolver],
	["float", floatResolver],
	["bool", boolResolver],
]);

/** @type {TagResolver} */
function refResolver() {}

/** @type {TagResolver} */
function envResolver() {}

/** @type {TagResolver} */
function stringResolver() {}

/** @type {TagResolver} */
function numberResolver() {}

/** @type {TagResolver} */
function intResolver() {}

/** @type {TagResolver} */
function floatResolver() {}

/** @type {TagResolver} */
function boolResolver() {}
