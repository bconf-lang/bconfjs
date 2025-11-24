import { describe, it } from "node:test";
import assert from "node:assert";
import { tokenize, TokenType, Token } from "./lexer.js";

/**
 * @param {Array<Token>} tokens
 * @param {boolean=} filterWhitespace
 * @returns {Array<string>}
 */
function extractTypes(tokens, filterWhitespace) {
	const mapped = tokens.map((t) => t.type);
	if (!filterWhitespace) {
		return mapped;
	}

	return mapped.filter((t) => t !== TokenType.WHITESPACE);
}

describe("Basic Tokens", () => {
	it("should tokenize EOF", () => {
		const tokens = tokenize("");
		assert.strictEqual(tokens.length, 1);
		assert.strictEqual(tokens[0].type, TokenType.EOF);
	});

	it("should tokenize whitespace", () => {
		const tokens = tokenize("   \t  ");
		assert.strictEqual(tokens[0].type, TokenType.WHITESPACE);
		assert.strictEqual(tokens[0].literal, "   \t  ");
	});

	it("should tokenize newlines (LF)", () => {
		const tokens = tokenize("\n");
		assert.strictEqual(tokens[0].type, TokenType.NEWLINE);
		assert.strictEqual(tokens[0].literal, "\n");
	});

	it("should tokenize newlines (CRLF)", () => {
		const tokens = tokenize("\r\n");
		assert.strictEqual(tokens[0].type, TokenType.NEWLINE);
		assert.strictEqual(tokens[0].literal, "\r\n");
	});

	it("should treat standalone CR as illegal", () => {
		const tokens = tokenize("\r");
		assert.strictEqual(tokens[0].type, TokenType.ILLEGAL);
		assert.strictEqual(tokens[0].literal, "\r");
	});

	it("should tokenize comments", () => {
		const tokens = tokenize("// This is a comment");
		assert.strictEqual(tokens[0].type, TokenType.COMMENT);
		assert.strictEqual(tokens[0].literal, "// This is a comment");
	});

	it("should tokenize operators", () => {
		const input = "= << . , ( ) [ ] { }";
		const tokens = tokenize(input);
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.ASSIGN,
			TokenType.APPEND,
			TokenType.DOT,
			TokenType.COMMA,
			TokenType.LPAREN,
			TokenType.RPAREN,
			TokenType.LBRACKET,
			TokenType.RBRACKET,
			TokenType.LBRACE,
			TokenType.RBRACE,
			TokenType.EOF,
		]);
	});

	it("should treat single < as illegal", () => {
		const tokens = tokenize("<");
		assert.strictEqual(tokens[0].type, TokenType.ILLEGAL);
		assert.strictEqual(tokens[0].literal, "<");
	});

	it("should treat single / as illegal", () => {
		const tokens = tokenize("/");
		assert.strictEqual(tokens[0].type, TokenType.ILLEGAL);
		assert.strictEqual(tokens[0].literal, "/");
	});
});

describe("Identifiers and Keywords", () => {
	it("should tokenize alphanumeric identifiers", () => {
		const tokens = tokenize("key123 alpha_key my-key");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.IDENTIFIER,
			TokenType.IDENTIFIER,
			TokenType.EOF,
		]);
	});

	it("should tokenize identifiers with numbers and signs", () => {
		const tokens = tokenize("123 -456 +789");
		const types = extractTypes(tokens, true);
		const literals = tokens
			.filter((t) => t.type !== TokenType.WHITESPACE)
			.map((t) => t.literal);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.IDENTIFIER,
			TokenType.IDENTIFIER,
			TokenType.EOF,
		]);
		assert.deepStrictEqual(literals, ["123", "-456", "+789", null]);
	});

	it("should recognize boolean keywords", () => {
		const tokens = tokenize("true false");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [TokenType.BOOLEAN, TokenType.BOOLEAN, TokenType.EOF]);
	});

	it("should recognize null keyword", () => {
		const tokens = tokenize("null");
		assert.strictEqual(tokens[0].type, TokenType.NULL);
		assert.strictEqual(tokens[0].literal, "null");
	});

	it("keyword should be case sensitive", () => {
		const tokens = tokenize("TRUE False NULL");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.IDENTIFIER,
			TokenType.IDENTIFIER,
			TokenType.EOF,
		]);
	});
});

describe("Variables", () => {
	it("should tokenize variables", () => {
		const tokens = tokenize("$variable $var_name $my-var");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.VARIABLE,
			TokenType.VARIABLE,
			TokenType.VARIABLE,
			TokenType.EOF,
		]);
	});

	it("should treat standalone $ as illegal", () => {
		const tokens = tokenize("$");
		assert.strictEqual(tokens[0].type, TokenType.ILLEGAL);
		assert.strictEqual(tokens[0].literal, "$");
	});

	it("should treat $ followed by invalid char as illegal", () => {
		const tokens = tokenize("$ key");
		assert.strictEqual(tokens[0].type, TokenType.ILLEGAL);
		assert.strictEqual(tokens[0].literal, "$");
	});

	it("should handle variables with numbers", () => {
		const tokens = tokenize("$var123");
		assert.strictEqual(tokens[0].type, TokenType.VARIABLE);
		assert.strictEqual(tokens[0].literal, "$var123");
	});
});

describe("Array Index Disambiguation", () => {
	it("should distinguish array index from regular array", () => {
		const tokens = tokenize("key[0]");
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.EOF,
		]);
	});

	it("should recognize regular array after whitespace", () => {
		const tokens = tokenize("key [0]");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.EOF,
		]);
	});

	it("should handle multi-dimensional array indexes", () => {
		const tokens = tokenize("key[0][1][2]");
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.EOF,
		]);
	});

	it("should handle multi-dimensional array indexes followed by regular array", () => {
		const tokens = tokenize("key[0][1][2] [123]");
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.WHITESPACE,
			TokenType.LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.EOF,
		]);
	});

	it("should recognize index accessor after variable", () => {
		const tokens = tokenize("$var[0]");
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.VARIABLE,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.EOF,
		]);
	});

	it("should recognize regular array after operator", () => {
		const tokens = tokenize("key = [0]");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.ASSIGN,
			TokenType.LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.EOF,
		]);
	});
});

describe("Strings", () => {
	it("should tokenize simple double-quoted strings", () => {
		const tokens = tokenize('"hello"');
		assert.deepStrictEqual(extractTypes(tokens), [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
		assert.strictEqual(tokens[1].literal, "hello");
	});

	it("should tokenize triple-quoted strings", () => {
		const tokens = tokenize('"""hello"""');
		assert.deepStrictEqual(extractTypes(tokens), [
			TokenType.TRIPLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.TRIPLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should tokenize empty strings", () => {
		const tokens = tokenize('""');
		assert.deepStrictEqual(extractTypes(tokens), [
			TokenType.DOUBLE_QUOTE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should allow newlines in triple-quoted strings", () => {
		const tokens = tokenize('"""line1\nline2"""');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.TRIPLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.TRIPLE_QUOTE,
			TokenType.EOF,
		]);
		assert.strictEqual(tokens[1].literal, "line1\nline2");
	});

	it("should allow tabs in triple-quoted strings", () => {
		const tokens = tokenize('"""\tindented"""');
		assert.strictEqual(tokens[1].type, TokenType.STRING_CONTENT);
		assert.strictEqual(tokens[1].literal, "\tindented");
	});

	it("should treat control chars as illegal in single-line strings", () => {
		const tokens = tokenize('"\t"');
		assert.strictEqual(tokens[1].type, TokenType.ILLEGAL);
		assert.strictEqual(tokens[1].literal, "\t");
	});

	it("should treat newline as illegal in single-line strings", () => {
		const tokens = tokenize('"hello\nworld"');
		assert.strictEqual(tokens[1].type, TokenType.STRING_CONTENT);
		assert.strictEqual(tokens[1].literal, "hello");
		assert.strictEqual(tokens[2].type, TokenType.ILLEGAL);
		assert.strictEqual(tokens[2].literal, "\n");
	});
});

describe("Escape Sequences", () => {
	it("should tokenize basic escape sequences", () => {
		const tokens = tokenize('"\\n\\t\\r"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.ESCAPE_SEQUENCE,
			TokenType.ESCAPE_SEQUENCE,
			TokenType.ESCAPE_SEQUENCE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should tokenize escaped quotes", () => {
		const tokens = tokenize('"\\""');
		assert.strictEqual(tokens[1].type, TokenType.ESCAPE_SEQUENCE);
		assert.strictEqual(tokens[1].literal, '\\"');
	});

	it("should tokenize escaped backslash", () => {
		const tokens = tokenize('"\\\\"');
		assert.strictEqual(tokens[1].type, TokenType.ESCAPE_SEQUENCE);
		assert.strictEqual(tokens[1].literal, "\\\\");
	});

	it("should tokenize escaped dollar sign", () => {
		const tokens = tokenize('"\\$"');
		assert.strictEqual(tokens[1].type, TokenType.ESCAPE_SEQUENCE);
		assert.strictEqual(tokens[1].literal, "\\$");
	});

	it("should tokenize unicode short escape", () => {
		const tokens = tokenize('"\\u0041"');
		assert.strictEqual(tokens[1].type, TokenType.ESCAPE_SEQUENCE);
		assert.strictEqual(tokens[1].literal, "\\u0041");
	});

	it("should tokenize unicode long escape", () => {
		const tokens = tokenize('"\\U00000041"');
		assert.strictEqual(tokens[1].type, TokenType.ESCAPE_SEQUENCE);
		assert.strictEqual(tokens[1].literal, "\\U00000041");
	});

	it("should handle incomplete unicode escape at EOF", () => {
		const tokens = tokenize('"\\u00"');
		assert.strictEqual(tokens[1].type, TokenType.ESCAPE_SEQUENCE);
		assert.strictEqual(tokens[1].literal, '\\u00"');
	});

	it("should split string content around escape sequences", () => {
		const tokens = tokenize('"hello\\nworld"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.ESCAPE_SEQUENCE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
		assert.strictEqual(tokens[1].literal, "hello");
		assert.strictEqual(tokens[2].literal, "\\n");
		assert.strictEqual(tokens[3].literal, "world");
	});
});

describe("Embedded Values", () => {
	it("should tokenize simple embedded values", () => {
		const tokens = tokenize('"hello ${world}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should tokenize embedded variables", () => {
		const tokens = tokenize('"value: ${$var}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.VARIABLE,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should tokenize multiple embedded values", () => {
		const tokens = tokenize('"${a} and ${b}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.RBRACE,
			TokenType.STRING_CONTENT,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle embedded values surrounded by string content", () => {
		const tokens = tokenize('"outer ${$var} text"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.VARIABLE,
			TokenType.RBRACE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle embedded values with dotted keys", () => {
		const tokens = tokenize('"${server.port}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.DOT,
			TokenType.IDENTIFIER,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle embedded values with array indexing", () => {
		const tokens = tokenize('"${arr[0]}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle deeply nested identifiers in embedded values", () => {
		const tokens = tokenize('"${a.b.c[0].d}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.DOT,
			TokenType.IDENTIFIER,
			TokenType.DOT,
			TokenType.IDENTIFIER,
			TokenType.INDEX_LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.RBRACKET,
			TokenType.DOT,
			TokenType.IDENTIFIER,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle embedded value at string start", () => {
		const tokens = tokenize('"${$var} suffix"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.VARIABLE,
			TokenType.RBRACE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle embedded value at string end", () => {
		const tokens = tokenize('"prefix ${$var}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.VARIABLE,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle consecutive embedded values", () => {
		const tokens = tokenize('"${a}${b}${c}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.RBRACE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.RBRACE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle escaped embedded value syntax", () => {
		const tokens = tokenize('"\\${not_embedded}"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.ESCAPE_SEQUENCE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should handle nested embedded values", () => {
		const tokens = tokenize('"outer ${"""${"${"embedded"}"}"""} text"');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.TRIPLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.DOUBLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.RBRACE,
			TokenType.DOUBLE_QUOTE,
			TokenType.RBRACE,
			TokenType.TRIPLE_QUOTE,
			TokenType.RBRACE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});
});

describe("Complex Scenarios", () => {
	it("should tokenize key-value pair", () => {
		const tokens = tokenize('key = "value"');
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.ASSIGN,
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should tokenize dotted key", () => {
		const tokens = tokenize("a.b.c = 123");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.DOT,
			TokenType.IDENTIFIER,
			TokenType.DOT,
			TokenType.IDENTIFIER,
			TokenType.ASSIGN,
			TokenType.IDENTIFIER,
			TokenType.EOF,
		]);
	});

	it("should tokenize quoted key", () => {
		const tokens = tokenize('"string key" = "value"');
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.ASSIGN,
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should tokenize empty quoted key", () => {
		const tokens = tokenize('"" = "value"');
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.DOUBLE_QUOTE,
			TokenType.ASSIGN,
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should tokenize object", () => {
		const tokens = tokenize("object { key = true }");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.LBRACE,
			TokenType.IDENTIFIER,
			TokenType.ASSIGN,
			TokenType.BOOLEAN,
			TokenType.RBRACE,
			TokenType.EOF,
		]);
	});

	it("should tokenize array", () => {
		const tokens = tokenize('[1, "two", true]');
		const types = extractTypes(tokens, true).filter((t) => t !== TokenType.STRING_CONTENT);
		assert.deepStrictEqual(types, [
			TokenType.LBRACKET,
			TokenType.IDENTIFIER,
			TokenType.COMMA,
			TokenType.DOUBLE_QUOTE,
			TokenType.DOUBLE_QUOTE,
			TokenType.COMMA,
			TokenType.BOOLEAN,
			TokenType.RBRACKET,
			TokenType.EOF,
		]);
	});

	it("should tokenize append operator usage", () => {
		const tokens = tokenize('list << "item"');
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.APPEND,
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.EOF,
		]);
	});

	it("should tokenize tag syntax", () => {
		const tokens = tokenize("value = ref(server.port)");
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.ASSIGN,
			TokenType.IDENTIFIER,
			TokenType.LPAREN,
			TokenType.IDENTIFIER,
			TokenType.DOT,
			TokenType.IDENTIFIER,
			TokenType.RPAREN,
			TokenType.EOF,
		]);
	});

	it("should handle comment at end of line", () => {
		const tokens = tokenize('key = "value" // comment');
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.ASSIGN,
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.DOUBLE_QUOTE,
			TokenType.COMMENT,
			TokenType.EOF,
		]);
	});

	it("should handle multiple lines", () => {
		const input = "key1 = 1\nkey2 = 2";
		const tokens = tokenize(input);
		const types = extractTypes(tokens, true);
		assert.deepStrictEqual(types, [
			TokenType.IDENTIFIER,
			TokenType.ASSIGN,
			TokenType.IDENTIFIER,
			TokenType.NEWLINE,
			TokenType.IDENTIFIER,
			TokenType.ASSIGN,
			TokenType.IDENTIFIER,
			TokenType.EOF,
		]);
	});
});

describe("Position Tracking", () => {
	it("should track row and column for single line", () => {
		const tokens = tokenize("abc = 123");
		assert.strictEqual(tokens[0].row, 1);
		assert.strictEqual(tokens[0].column, 1);
		assert.strictEqual(tokens[2].column, 5); // =
		assert.strictEqual(tokens[4].column, 7); // 123
	});

	it("should track row across newlines", () => {
		const tokens = tokenize("line1\nline2");
		assert.strictEqual(tokens[0].row, 1); // line1
		assert.strictEqual(tokens[1].row, 2); // \n
		assert.strictEqual(tokens[2].row, 2); // line2
	});

	it("should reset column after newline", () => {
		const tokens = tokenize("abc\ndef");
		assert.strictEqual(tokens[2].column, 1); // "def" starts at column 1
	});

	it("should handle CRLF properly in position tracking", () => {
		const tokens = tokenize("line1\r\nline2");
		assert.strictEqual(tokens[2].row, 2);
		assert.strictEqual(tokens[2].column, 1);
	});
});

describe("Edge Cases", () => {
	it("should handle orphaned closing brace outside embedded value", () => {
		const tokens = tokenize("}");
		assert.strictEqual(tokens[0].type, TokenType.RBRACE);
	});

	it("should handle empty input", () => {
		const tokens = tokenize("");
		assert.strictEqual(tokens.length, 1);
		assert.strictEqual(tokens[0].type, TokenType.EOF);
	});

	it("should handle only whitespace", () => {
		const tokens = tokenize("   \t   ");
		assert.strictEqual(tokens[0].type, TokenType.WHITESPACE);
		assert.strictEqual(tokens[1].type, TokenType.EOF);
	});

	it("should handle only comments", () => {
		const tokens = tokenize("// just a comment");
		assert.strictEqual(tokens[0].type, TokenType.COMMENT);
		assert.strictEqual(tokens[1].type, TokenType.EOF);
	});

	it("should handle unclosed string at EOF", () => {
		const tokens = tokenize('"unclosed');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.STRING_CONTENT,
			TokenType.EOF,
		]);
	});

	it("should handle unclosed embedded value at EOF", () => {
		const tokens = tokenize('"${unclosed');
		const types = extractTypes(tokens);
		assert.deepStrictEqual(types, [
			TokenType.DOUBLE_QUOTE,
			TokenType.EMBEDDED_VALUE_START,
			TokenType.IDENTIFIER,
			TokenType.EOF,
		]);
	});

	it("should handle control characters in strings", () => {
		const tokens = tokenize('"\x00"');
		assert.strictEqual(tokens[1].type, TokenType.ILLEGAL);
	});

	it("should handle DEL character", () => {
		const tokens = tokenize('"\x7F"');
		assert.strictEqual(tokens[1].type, TokenType.ILLEGAL);
	});

	it("should handle C1 control characters", () => {
		const tokens = tokenize('"\x80"');
		assert.strictEqual(tokens[1].type, TokenType.ILLEGAL);
	});

	it("should handle very long identifiers", () => {
		const longId = "a".repeat(1000);
		const tokens = tokenize(longId);
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, longId);
	});

	it("should handle identifiers that are all numbers", () => {
		const tokens = tokenize("1234");
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "1234");
	});

	it("should handle underscores in numbers", () => {
		const tokens = tokenize("1_000_000");
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "1_000_000");
	});

	it("should handle leading underscores in numbers", () => {
		const tokens = tokenize("_1_000_000");
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "_1_000_000");
	});

	it("should handle trailing underscores in numbers", () => {
		const tokens = tokenize("1_000_000_");
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "1_000_000_");
	});

	it("should handle consecutive underscores in numbers", () => {
		const tokens = tokenize("1___000_000");
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "1___000_000");
	});

	it("should handle negative numbers", () => {
		const tokens = tokenize("-42");
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "-42");
	});

	it("should handle positive numbers with sign", () => {
		const tokens = tokenize("+42");
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "+42");
	});

	it("should handle floats", () => {
		const tokens = tokenize("3.14159");
		assert.strictEqual(tokens.length, 4); // +1 for EOF
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "3");
		assert.strictEqual(tokens[1].type, TokenType.DOT);
		assert.strictEqual(tokens[2].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[2].literal, "14159");
	});

	it("should handle scientific notation", () => {
		const tokens = tokenize("1.23e10");
		assert.strictEqual(tokens.length, 4); // +1 for EOF
		assert.strictEqual(tokens[0].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[0].literal, "1");
		assert.strictEqual(tokens[1].type, TokenType.DOT);
		assert.strictEqual(tokens[2].type, TokenType.IDENTIFIER);
		assert.strictEqual(tokens[2].literal, "23e10");
	});
});
