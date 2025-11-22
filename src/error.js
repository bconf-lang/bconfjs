/** @import { Token } from './lexer.js' */

export class BconfError extends Error {
	/**
	 * @param {string} message
	 * @param {Token} token
	 */
	constructor(message, token) {
		super(`${message} at line ${token.row} column ${token.column} of the bconf data`);

		this.name = "BconfError";
		this.row = token.row;
		this.column = token.column;
	}
}
