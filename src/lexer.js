/**
 * @typedef {{ mode: number, stringType: number }} LexerContext
 */

/**
 * @param {string} input Input bconf file
 */
export function tokenize(input) {
	const lexer = new Lexer(input);
	return lexer.tokenize();
}

export const TokenType = {
	// Special
	ILLEGAL: "ILLEGAL",
	EOF: "EOF",

	// Literals
	STRING_CONTENT: "STRING_CONTENT",
	BOOLEAN: "BOOLEAN",
	NULL: "NULL",

	// Identifiers & Variables
	IDENTIFIER: "IDENTIFIER", // For keys, tags, numbers and unquoted statement values
	VARIABLE: "VARIABLE",
	INDEX_LBRACKET: "INDEX_LBRACKET", // [ for denoting the start of an array index

	// Operators & Delimiters
	ASSIGN: "ASSIGN", // =
	APPEND: "APPEND", // <<
	DOT: "DOT", // .
	COMMA: "COMMA", // ,
	LBRACE: "LBRACE", // {
	RBRACE: "RBRACE", // }
	LBRACKET: "LBRACKET", // [
	RBRACKET: "RBRACKET", // ]
	LPAREN: "LPAREN", // (
	RPAREN: "RPAREN", // )
	COMMENT: "COMMENT", // Double slash consuming characters up to new line
	WHITESPACE: "WHITESPACE", // Space and tab characters
	NEWLINE: "NEWLINE", // \n or \r\n sequence

	// Strings
	DOUBLE_QUOTE: "DOUBLE_QUOTE", // "
	TRIPLE_QUOTE: "TRIPLE_QUOTE", // """
	EMBEDDED_VALUE_START: "EMBEDDED_VALUE_START", // ${
	EMBEDDED_VALUE_END: "EMBEDDED_VALUE_END", // }
	ESCAPE_SEQUENCE: "ESCAPE_SEQUENCE", // Escape sequence in a string
};

export const Keywords = {
	TRUE: "true",
	FALSE: "false",
	NULL: "null",
};

const LexerMode = {
	DEFAULT: 0,
	STRING: 1,
	EMBEDDED_VALUE: 2,
	// This is essentially an alias for the default mode to ensure objects inside
	// tag parenthesis are correctly captured, mainly when tags are inside an embedded
	// value like `"value ${tag({ foo = 1 })}"` since
	TAGGED_VALUE: 3,
};

const StringType = {
	OFF: -1,
	DOUBLE: 0,
	TRIPLE: 1,
};

// Since integers are also valid identifiers, they should be collected as one
// and left to the parser to differentiate the true type. Only `+` is unique
// to numbers and cannot be used in an alphanumeric key, so the parser will
// need to account for whether or not the key is valid
const IDENTIFIER_CANDIDATE_REGEX = /[A-Za-z0-9_+-]/;
const ALPHANUMERIC_REGEX = /[A-Za-z0-9_-]/;
const UNICODE_SHORT_ESCAPE_LENGTH = 4;
const UNICODE_LONG_ESCAPE_LENGTH = 8;

export class Token {
	/**
	 * @param {string} type The type of the token
	 * @param {string | null} literal The value for the token
	 * @param {number} row What row the token appears on in the input
	 * @param {number} column What column the token starts on in the input
	 */
	constructor(type, literal, row, column) {
		this.type = type;
		this.literal = literal;
		this.row = row;
		this.column = column;
	}
}

export class Lexer {
	/** @type {string} */ input;
	/** @type {number} */ position = 0;
	/** @type {number} */ column = 1;
	/** @type {number} */ row = 1;
	/** @type {LexerContext[]} */ contextStack = [
		{ mode: LexerMode.DEFAULT, stringType: StringType.OFF },
	];
	/** @type {Token | null} */ lastToken = null;

	/**
	 * @param {string} input
	 */
	constructor(input) {
		this.input = input;
	}

	/** @returns {LexerContext} */
	get currentContext() {
		return this.contextStack[this.contextStack.length - 1];
	}

	/**
	 * @param {number} n
	 * @returns {string | null}
	 */
	peek(n = 0) {
		const nextPos = this.position + n;
		if (nextPos >= this.input.length) {
			return null;
		}

		return this.input[nextPos];
	}

	advance(count = 1) {
		let char;
		for (let i = 0; i < count; i++) {
			char = this.peek();
			if (char === null) {
				return null;
			}

			if (char === "\n") {
				this.row++;
				this.column = 1;
			} else if (char !== "\r") {
				this.column++;
			}
			this.position++;
		}
	}

	readWhitespace() {
		const startPos = this.position;
		const startCol = this.column;
		while (this.peek() === " " || this.peek() === "\t") {
			this.advance();
		}

		const literal = this.input.substring(startPos, this.position);
		return new Token(TokenType.WHITESPACE, literal, this.row, startCol);
	}

	readComment() {
		const startPos = this.position;
		const startCol = this.column;
		while (this.peek() !== "\n" && this.peek() !== "\r" && this.peek() !== null) {
			this.advance();
		}

		const literal = this.input.substring(startPos, this.position);
		return new Token(TokenType.COMMENT, literal, this.row, startCol);
	}

	/**
	 * @returns {Token}
	 */
	readIdentifier() {
		const startPos = this.position;
		const startCol = this.column;

		let char = this.peek();
		while (char !== null && IDENTIFIER_CANDIDATE_REGEX.test(char)) {
			this.advance();
			char = this.peek();
		}

		const literal = this.input.substring(startPos, this.position);
		if (literal === Keywords.TRUE || literal === Keywords.FALSE) {
			return new Token(TokenType.BOOLEAN, literal, this.row, startCol);
		}

		if (literal === Keywords.NULL) {
			return new Token(TokenType.NULL, literal, this.row, startCol);
		}

		return new Token(TokenType.IDENTIFIER, literal, this.row, startCol);
	}

	/**
	 * @returns {Token}
	 */
	readVariable() {
		const startPos = this.position;
		const startCol = this.column;
		this.advance(); // Consume $

		let char = this.peek();
		while (char !== null && ALPHANUMERIC_REGEX.test(char)) {
			this.advance();
			char = this.peek();
		}

		const literal = this.input.substring(startPos, this.position);
		return new Token(TokenType.VARIABLE, literal, this.row, startCol);
	}

	/**
	 * @returns {Token}
	 */
	readEscapeSequence() {
		const startPos = this.position;
		const startCol = this.column;

		// Next character after the backslash
		const char = this.peek(1);
		let charsToAdvance = 2;
		if (char === "u") {
			charsToAdvance += UNICODE_SHORT_ESCAPE_LENGTH;
		} else if (char === "U") {
			charsToAdvance += UNICODE_LONG_ESCAPE_LENGTH;
		}

		// Don't want to go beyond EOF. That should be its own token,
		// not consumed as part of the escape sequence
		if (this.position + charsToAdvance > this.input.length) {
			// Consume whats left
			this.advance(this.input.length - this.position);
		} else {
			this.advance(charsToAdvance);
		}

		const literal = this.input.substring(startPos, this.position);
		return new Token(TokenType.ESCAPE_SEQUENCE, literal, this.row, startCol);
	}

	/**
	 * @returns {Token | null}
	 */
	readStringContent() {
		const startPos = this.position;
		const startCol = this.column;

		let currChar = this.peek();
		while (currChar !== null && currChar !== '"') {
			if (currChar === "\\") {
				if (this.position > startPos) {
					const literal = this.input.substring(startPos, this.position);
					return new Token(TokenType.STRING_CONTENT, literal, this.row, startCol);
				}

				return this.readEscapeSequence();
			}

			if (currChar === "$" && this.peek(1) === "{") {
				if (this.position > startPos) {
					const literal = this.input.substring(startPos, this.position);
					return new Token(TokenType.STRING_CONTENT, literal, this.row, startCol);
				}

				this.contextStack.push({
					mode: LexerMode.EMBEDDED_VALUE,
					stringType: this.currentContext.stringType,
				});
				this.advance(2);
				return new Token(TokenType.EMBEDDED_VALUE_START, "${", this.row, startCol);
			}

			if (!isAllowedChar(currChar, this.currentContext.stringType)) {
				if (this.position > startPos) {
					const literal = this.input.substring(startPos, this.position);
					return new Token(TokenType.STRING_CONTENT, literal, this.row, startCol);
				}

				this.advance();
				return new Token(TokenType.ILLEGAL, currChar, this.row, startCol);
			}

			this.advance();
			currChar = this.peek();
		}

		if (this.position > startPos) {
			const literal = this.input.substring(startPos, this.position);
			return new Token(TokenType.STRING_CONTENT, literal, this.row, startCol);
		}

		return null;
	}

	/**
	 * @returns {Token}
	 */
	readToken() {
		const char = this.peek();
		const col = this.column;

		if (char === null) {
			return new Token(TokenType.EOF, null, this.row, col);
		}

		// Always prioritize reading string content to prevent the wrong tokens from being
		// created in the switch statement below
		if (this.currentContext.mode === LexerMode.STRING) {
			const token = this.readStringContent();

			// If no token is returned, it means there is a boundary that was reached (EOF, string delimiter).
			// The switch statement will handle those tokens below
			if (token) {
				return token;
			}
		}

		switch (char) {
			case " ":
			case "\t":
				return this.readWhitespace();
			case "/":
				if (this.peek(1) === "/") {
					return this.readComment();
				}
				this.advance();
				return new Token(TokenType.ILLEGAL, "/", this.row, col);
			case "=":
				this.advance();
				return new Token(TokenType.ASSIGN, "=", this.row, col);
			case "<":
				if (this.peek(1) === "<") {
					this.advance(2);
					return new Token(TokenType.APPEND, "<<", this.row, col);
				}
				this.advance();
				return new Token(TokenType.ILLEGAL, "<", this.row, col);
			case ".":
				this.advance();
				return new Token(TokenType.DOT, ".", this.row, col);
			case "(":
				// Adding a new context to account for objects inside tags, inside an embedded value
				// (eg. `"string ${tag({ foo = 1 })}"`). Without it, the logic below when handling `}`
				// will wrongly infer the first closing brace of the object is the closing brace for the
				// embedded value. So the remaining `)}` will be treated as string content and not the correct
				// LPAREN and RBRACE tokens
				if (this.lastToken?.type === TokenType.IDENTIFIER) {
					this.contextStack.push({ mode: LexerMode.DEFAULT, stringType: StringType.OFF });
				}
				this.advance();
				return new Token(TokenType.LPAREN, "(", this.row, col);
			case ")":
				if (
					this.currentContext.mode === LexerMode.DEFAULT &&
					this.contextStack.length > 1
				) {
					this.contextStack.pop();
				}
				this.advance();
				return new Token(TokenType.RPAREN, ")", this.row, col);
			case "[":
				this.advance();
				return new Token(
					// This just makes it easier to differentiate array indexes from regular arrays
					// primarily in statements where having a single token is ambiguous when whitespace
					// is filtered out. RBRACKET is to account multi-dimensional indexes (ie. `foo[0][1]`).
					// Regular arrays should always be captured correctly since it will be separated by whitespace
					// or an operator
					this.lastToken?.type === TokenType.IDENTIFIER ||
						this.lastToken?.type === TokenType.VARIABLE ||
						this.lastToken?.type === TokenType.RBRACKET
						? TokenType.INDEX_LBRACKET
						: TokenType.LBRACKET,
					"[",
					this.row,
					col,
				);
			case "]":
				this.advance();
				return new Token(TokenType.RBRACKET, "]", this.row, col);
			case "$":
				if (ALPHANUMERIC_REGEX.test(this.peek(1) ?? "")) {
					return this.readVariable();
				}
				this.advance();
				return new Token(TokenType.ILLEGAL, "$", this.row, col);
			case "{":
				this.advance();
				return new Token(TokenType.LBRACE, "{", this.row, col);
			case "}":
				this.advance();
				if (this.currentContext.mode === LexerMode.EMBEDDED_VALUE) {
					if (this.contextStack.length <= 1) {
						// Orphaned closing brace outside any embedded value
						return new Token(TokenType.ILLEGAL, "}", this.row, col);
					}

					this.contextStack.pop();
				}
				return new Token(TokenType.RBRACE, "}", this.row, col);
			case ",":
				this.advance();
				return new Token(TokenType.COMMA, ",", this.row, col);
			case "\n":
				this.advance();
				return new Token(TokenType.NEWLINE, "\n", this.row, col);
			case "\r":
				// Check if it's the start of a CRLF sequence
				if (this.peek(1) === "\n") {
					this.advance(2); // Consume \n
					return new Token(TokenType.NEWLINE, "\r\n", this.row, col);
				}
				this.advance();
				return new Token(TokenType.ILLEGAL, "\r", this.row, col);

			case '"': {
				const isTripleQuote = this.peek(1) === '"' && this.peek(2) === '"';

				if (this.currentContext.mode === LexerMode.STRING) {
					this.contextStack.pop();
				} else {
					this.contextStack.push({
						mode: LexerMode.STRING,
						stringType: isTripleQuote ? StringType.TRIPLE : StringType.DOUBLE,
					});
				}

				this.advance(isTripleQuote ? 3 : 1);
				return new Token(
					isTripleQuote ? TokenType.TRIPLE_QUOTE : TokenType.DOUBLE_QUOTE,
					isTripleQuote ? '"""' : '"',
					this.row,
					col,
				);
			}

			default:
				if (IDENTIFIER_CANDIDATE_REGEX.test(char)) {
					return this.readIdentifier();
				}

				this.advance();
				return new Token(TokenType.ILLEGAL, char, this.row, col);
		}
	}

	/**
	 * @returns {Token}
	 */
	next() {
		const token = this.readToken();
		this.lastToken = token;
		return token;
	}

	/**
	 * @returns {Array<Token>}
	 */
	tokenize() {
		/** @type {Array<Token>} */
		const tokens = [];

		let currToken = this.next();
		while (currToken.type !== TokenType.EOF) {
			tokens.push(currToken);
			currToken = this.next();
		}

		// Making sure the last token is still collected and returned (ie. EOF)
		tokens.push(currToken);
		return tokens;
	}
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isDisallowedChar(char) {
	const code = char.codePointAt(0);
	if (!code) {
		return true;
	}

	// Control chars (C0, C1 and DEL)
	if (
		(code >= 0x0000 && code <= 0x001f) ||
		code === 0x007f ||
		(code >= 0x0080 && code <= 0x009f)
	) {
		return true;
	}

	// Special chars (", $, \)
	if (code === 0x22 || code === 0x24 || code === 0x5c) {
		return true;
	}

	return false;
}

/**
 * @param {string} char
 * @param {number} type The string type
 * @returns {boolean}
 */
function isAllowedChar(char, type) {
	const disallowed = isDisallowedChar(char);
	if (disallowed) {
		if (type === StringType.TRIPLE && (char === "\n" || char === "\t")) {
			return true;
		}
	}

	return !disallowed;
}
