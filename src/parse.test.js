import { describe, it } from "node:test";
import assert from "node:assert";
import { parse } from "./parse.js";
import { BconfError } from "./error.js";

/**
 * Helper to assert that parsing throws an error
 * @param {string} input
 * @param {string=} messageMatch
 */
async function assertThrows(input, messageMatch) {
	await assert.rejects(
		async () => await parse(input),
		(err) => {
			assert.ok(err instanceof BconfError);
			if (messageMatch) {
				assert.ok(
					err.message.includes(messageMatch),
					`Expected error message to include "${messageMatch}", got "${err.message}"`,
				);
			}
			return true;
		},
	);
}

describe("Basic Values", () => {
	it("should parse boolean values", async () => {
		const { data } = await parse("bool_true = true\nbool_false = false");
		assert.deepStrictEqual(data, { bool_true: true, bool_false: false });
	});

	it("should parse null values", async () => {
		const { data } = await parse("value = null");
		assert.deepStrictEqual(data, { value: null });
	});

	it("should parse integer values", async () => {
		const { data } = await parse("int = 42");
		assert.deepStrictEqual(data, { int: 42 });
	});

	it("should parse negative integers", async () => {
		const { data } = await parse("int = -42");
		assert.deepStrictEqual(data, { int: -42 });
	});

	it("should parse positive integers with sign", async () => {
		const { data } = await parse("int = +42");
		assert.deepStrictEqual(data, { int: 42 });
	});

	it("should parse integers with underscores", async () => {
		const { data } = await parse("int = 1_000_000");
		assert.deepStrictEqual(data, { int: 1000000 });
	});

	it("should parse float values", async () => {
		const { data } = await parse("float = 3.14");
		assert.deepStrictEqual(data, { float: 3.14 });
	});

	it("should parse floats with underscores", async () => {
		const { data } = await parse("float = 5_349.123_456");
		assert.deepStrictEqual(data, { float: 5349.123456 });
	});

	it("should parse floats with exponents", async () => {
		const { data } = await parse("float = 1.2e10");
		assert.strictEqual(data.float, 1.2e10);
	});

	it("should parse floats with negative exponents", async () => {
		const { data } = await parse("float = -2e-2");
		assert.strictEqual(data.float, -2e-2);
	});

	it("should parse integers with exponents as floats", async () => {
		const { data } = await parse("float = 2e2");
		assert.strictEqual(data.float, 2e2);
	});

	it("should parse string values", async () => {
		const { data } = await parse('str = "hello world"');
		assert.deepStrictEqual(data, { str: "hello world" });
	});

	it("should parse empty strings", async () => {
		const { data } = await parse('str = ""');
		assert.deepStrictEqual(data, { str: "" });
	});

	it("should parse multi-line strings", async () => {
		const { data } = await parse('str = """line1\nline2"""');
		assert.deepStrictEqual(data, { str: "line1\nline2" });
	});
});

describe("Invalid Syntax", () => {
	it("should reject invalid key with +", async () => {
		await assertThrows("invalid+key = 123", "invalid key");
	});

	it("should reject empty key", async () => {
		await assertThrows(' "" = "value"', "unexpected empty key part");
	});

	it("should reject negative array index", async () => {
		await assertThrows("arr[-1] = 1", "non-negative");
	});

	it("should reject float array index", async () => {
		await assertThrows("arr[1.5] = 1", "integer");
	});

	it("should reject unclosed array index", async () => {
		await assertThrows("arr[0 = 1", "expected ']'");
	});

	it("should reject leading decimal point", async () => {
		await assertThrows("num = .5", "unexpected value '.'");
	});

	it("should reject trailing decimal point", async () => {
		await assertThrows("num = 5.", "unterminated float");
	});

	it("should reject unterminated string", async () => {
		await assertThrows('"unclosed', "unexpected value in string");
	});

	it("should reject invalid escape sequence", async () => {
		await assertThrows('"\\a"', "invalid escape sequence");
	});

	it("should reject invalid unicode escape", async () => {
		await assertThrows('"\\uZZZZ"', "invalid escaped unicode");
	});

	it("should reject unclosed object", async () => {
		await assertThrows("obj { key = 1", "expected '}'");
	});

	it("should reject unclosed array", async () => {
		await assertThrows("arr = [1, 2", "expected ']'");
	});

	it("should reject invalid tag syntax", async () => {
		await assertThrows("val = tag", "unexpected identifier as value 'tag'");
	});

	it("should reject tag without closing paren", async () => {
		await assertThrows("foo=123\nval = ref(foo", "expected ')'");
	});

	it("should reject standalone identifier as value", async () => {
		await assertThrows("val = foo", "unexpected identifier as value 'foo'");
	});
});

describe("Keys", () => {
	it("should parse alphanumeric keys", async () => {
		const { data } = await parse("key-name = 1\nkey_name2 = 2");
		assert.deepStrictEqual(data, { "key-name": 1, key_name2: 2 });
	});

	it("should parse numeric keys as strings", async () => {
		const { data } = await parse("1234 = true");
		assert.deepStrictEqual(data, { 1234: true });
	});

	it("should parse quoted keys", async () => {
		const { data } = await parse('"string key" = "value"');
		assert.deepStrictEqual(data, { "string key": "value" });
	});

	it("should parse dotted keys", async () => {
		const { data } = await parse("a.b.c = 1");
		assert.deepStrictEqual(data, { a: { b: { c: 1 } } });
	});

	it("should parse mixed dotted keys", async () => {
		const { data } = await parse('a."b".c = 1');
		assert.deepStrictEqual(data, { a: { b: { c: 1 } } });
	});

	it("should parse array index accessor", async () => {
		const { data } = await parse("arr[0] = 1");
		assert.deepStrictEqual(data, { arr: [1] });
	});

	it("should pad array with nulls for out-of-bounds index", async () => {
		const { data } = await parse("arr[2] = 3");
		assert.deepStrictEqual(data, { arr: [null, null, 3] });
	});

	it("should parse multi-dimensional array indexes", async () => {
		const { data } = await parse("arr[0][1] = 2");
		assert.deepStrictEqual(data, { arr: [[null, 2]] });
	});

	it("should parse dotted keys with array indexes", async () => {
		const { data } = await parse('data.users[0] = "Alice"');
		assert.deepStrictEqual(data, { data: { users: ["Alice"] } });
	});

	it("should allow last key to win on duplicates", async () => {
		const { data } = await parse("foo = 1\nfoo = 2");
		assert.deepStrictEqual(data, { foo: 2 });
	});

	it("should reject variable keys after first key", async () => {
		await assertThrows("foo.$bar = 1", "unexpected variable key");
	});

	it("should reject dotted keys in statements", async () => {
		await assertThrows("allow a.b.c", "dotted keys are not allowed in statements");
	});

	it("should reject array indexes in statements", async () => {
		await assertThrows("allow arr[0]", "array indexes are not allowed in statements");
	});
});

describe("Operators", () => {
	it("should parse assignment operator", async () => {
		const { data } = await parse("key = 123");
		assert.deepStrictEqual(data, { key: 123 });
	});

	it("should parse append operator", async () => {
		const { data } = await parse('list << "a"\nlist << "b"');
		assert.deepStrictEqual(data, { list: ["a", "b"] });
	});

	it("should create array on first append", async () => {
		const { data } = await parse('new_list << "first"');
		assert.deepStrictEqual(data, { new_list: ["first"] });
	});

	it("should parse object shorthand", async () => {
		const { data } = await parse("obj { key = 1 }");
		assert.deepStrictEqual(data, { obj: { key: 1 } });
	});

	it("should parse true shorthand", async () => {
		const { data } = await parse("enabled");
		assert.deepStrictEqual(data, { enabled: true });
	});

	it("should parse true shorthand before newline", async () => {
		const { data } = await parse("enabled\nport = 8080");
		assert.deepStrictEqual(data, { enabled: true, port: 8080 });
	});
});

describe("Objects", () => {
	it("should parse simple object", async () => {
		const { data } = await parse("obj = { key = 1 }");
		assert.deepStrictEqual(data, { obj: { key: 1 } });
	});

	it("should parse nested objects", async () => {
		const { data } = await parse("obj = { nested = { deep = true } }");
		assert.deepStrictEqual(data, { obj: { nested: { deep: true } } });
	});

	it("should parse object with multiple keys", async () => {
		const { data } = await parse("obj = { a = 1, b = 2, c = 3 }");
		assert.deepStrictEqual(data, { obj: { a: 1, b: 2, c: 3 } });
	});

	it("should parse object with newline separators", async () => {
		const { data } = await parse("obj = {\n  a = 1\n  b = 2\n}");
		assert.deepStrictEqual(data, { obj: { a: 1, b: 2 } });
	});

	it("should parse object with trailing comma", async () => {
		const { data } = await parse("obj = { a = 1, }");
		assert.deepStrictEqual(data, { obj: { a: 1 } });
	});

	it("should parse empty object", async () => {
		const { data } = await parse("obj = {}");
		assert.deepStrictEqual(data, { obj: {} });
	});

	it("should parse object shorthand syntax", async () => {
		const { data } = await parse("config { port = 8080 }");
		assert.deepStrictEqual(data, { config: { port: 8080 } });
	});

	it("should parse object with true shorthand inside", async () => {
		const { data } = await parse("obj = { enabled, port = 8080 }");
		assert.deepStrictEqual(data, { obj: { enabled: true, port: 8080 } });
	});
});

describe("Arrays", () => {
	it("should parse simple array", async () => {
		const { data } = await parse("arr = [1, 2, 3]");
		assert.deepStrictEqual(data, { arr: [1, 2, 3] });
	});

	it("should parse array with mixed types", async () => {
		const { data } = await parse('arr = [1, "two", true, null]');
		assert.deepStrictEqual(data, { arr: [1, "two", true, null] });
	});

	it("should parse nested arrays", async () => {
		const { data } = await parse("arr = [[1, 2], [3, 4]]");
		assert.deepStrictEqual(data, {
			arr: [
				[1, 2],
				[3, 4],
			],
		});
	});

	it("should parse array with objects", async () => {
		const { data } = await parse("arr = [{ a = 1 }, { b = 2 }]");
		assert.deepStrictEqual(data, { arr: [{ a: 1 }, { b: 2 }] });
	});

	it("should parse array with newline separators", async () => {
		const { data } = await parse("arr = [\n  1\n  2\n  3\n]");
		assert.deepStrictEqual(data, { arr: [1, 2, 3] });
	});

	it("should parse array with trailing comma", async () => {
		const { data } = await parse("arr = [1, 2, 3,]");
		assert.deepStrictEqual(data, { arr: [1, 2, 3] });
	});

	it("should parse empty array", async () => {
		const { data } = await parse("arr = []");
		assert.deepStrictEqual(data, { arr: [] });
	});

	it("should parse array with empty lines", async () => {
		const { data } = await parse("arr = [\n\n  1\n\n  2\n\n]");
		assert.deepStrictEqual(data, { arr: [1, 2] });
	});
});

describe("Strings", () => {
	it("should parse string with escape sequences", async () => {
		const { data } = await parse('str = "line1\\nline2"');
		assert.deepStrictEqual(data, { str: "line1\nline2" });
	});

	it("should parse all basic escape sequences", async () => {
		const { data } = await parse('str = "\\"\\\\\\$\\b\\f\\n\\r\\t"');
		assert.strictEqual(data.str, '"\\$\b\f\n\r\t');
	});

	it("should parse unicode short escape", async () => {
		const { data } = await parse('str = "\\u0041"');
		assert.deepStrictEqual(data, { str: "A" });
	});

	it("should parse unicode long escape", async () => {
		const { data } = await parse('str = "\\U00000041"');
		assert.deepStrictEqual(data, { str: "A" });
	});

	it("should parse quoted keys with escape sequences", async () => {
		const { data } = await parse('"key\\nname" = 1');
		assert.deepStrictEqual(data, { "key\nname": 1 });
	});

	it("should reject multi-line strings as keys", async () => {
		// This should be caught by the lexer, but verifying parser behavior
		const input = '"""multi\nline""" = 1';
		await assertThrows(input);
	});
});

describe("Embedded Values", () => {
	it("should parse simple embedded value", async () => {
		const { data } = await parse('$var = "world"\nstr = "hello ${$var}"');
		assert.deepStrictEqual(data, { str: "hello world" });
	});

	it("should parse multiple embedded values", async () => {
		const { data } = await parse('$a = "foo"\n$b = "bar"\nstr = "${$a} and ${$b}"');
		assert.deepStrictEqual(data, { str: "foo and bar" });
	});

	it("should parse embedded numbers", async () => {
		const { data } = await parse('str = "value: ${42}"');
		assert.deepStrictEqual(data, { str: "value: 42" });
	});

	it("should parse embedded booleans", async () => {
		const { data } = await parse('str = "enabled: ${true}"');
		assert.deepStrictEqual(data, { str: "enabled: true" });
	});

	it("should parse embedded null", async () => {
		const { data } = await parse('str = "value: ${null}"');
		assert.deepStrictEqual(data, { str: "value: null" });
	});

	it("should parse embedded dotted variable paths", async () => {
		const { data } = await parse('$obj = { key = "value" }\nstr = "${$obj.key}"');
		assert.deepStrictEqual(data, { str: "value" });
	});

	it("should reject unresolved variables in embedded values", async () => {
		await assertThrows('str = "${$undefined}"', "could not resolve variable");
	});

	it("should reject non-primitive embedded values", async () => {
		await assertThrows('$obj = { a = 1 }\nstr = "${$obj}"', "must resolve to a primitive");
	});

	it("should parse escaped embedded value syntax", async () => {
		const { data } = await parse('str = "\\${not embedded}"');
		assert.deepStrictEqual(data, { str: "${not embedded}" });
	});

	it("should parse consecutive embedded values", async () => {
		const { data } = await parse('$a = "A"\n$b = "B"\nstr = "${$a}${$b}"');
		assert.deepStrictEqual(data, { str: "AB" });
	});

	it("should parse embedded values at string boundaries", async () => {
		const { data } = await parse('$var = "X"\nstr1 = "${$var} end"\nstr2 = "start ${$var}"');
		assert.deepStrictEqual(data, { str1: "X end", str2: "start X" });
	});
});

describe("Variables", () => {
	it("should define and use variables", async () => {
		const { data } = await parse("$port = 8080\nserver.port = $port");
		assert.deepStrictEqual(data, { server: { port: 8080 } });
	});

	it("should support variable reassignment", async () => {
		const { data } = await parse("$val = 1\n$val = 2\nkey = $val");
		assert.deepStrictEqual(data, { key: 2 });
	});

	it("should support append with variables", async () => {
		const { data } = await parse('$list << "a"\n$list << "b"\nresult = $list');
		assert.deepStrictEqual(data, { result: ["a", "b"] });
	});

	it("should reject undefined variables", async () => {
		await assertThrows("key = $undefined", "could not resolve variable");
	});

	it("should reject variables used before definition", async () => {
		await assertThrows("key = $var\n$var = 1", "could not resolve variable");
	});

	it("should support variable scoping in objects", async () => {
		const { data } = await parse("obj { $local = 1\nkey = $local }");
		assert.deepStrictEqual(data, { obj: { key: 1 } });
	});

	it("should reject variables from child scopes", async () => {
		await assertThrows("obj { $local = 1 }\nkey = $local", "could not resolve variable");
	});

	it("should access parent scope variables", async () => {
		const { data } = await parse("$global = 1\nobj { key = $global }");
		assert.deepStrictEqual(data, { obj: { key: 1 } });
	});

	it("should handle dotted variable paths", async () => {
		const { data } = await parse("$obj = { nested = { value = 42 } }\nkey = $obj.nested.value");
		assert.deepStrictEqual(data, { key: 42 });
	});

	it("should handle variable with array index", async () => {
		const { data } = await parse("$arr = [1, 2, 3]\nkey = $arr[1]");
		assert.deepStrictEqual(data, { key: 2 });
	});

	it("should not include variables in output", async () => {
		const { data } = await parse("$var = 1\nkey = $var");
		assert.deepStrictEqual(data, { key: 1 });
		assert.ok(!("$var" in data));
	});
});

describe("Tags", () => {
	it("should parse ref() tag", async () => {
		const { data } = await parse("server.port = 8080\ndefault_port = ref(server.port)");
		assert.deepStrictEqual(data, { server: { port: 8080 }, default_port: 8080 });
	});

	it("should reject ref() to undefined key", async () => {
		await assertThrows("val = ref(undefined.key)", "no value exists at key 'undefined.key'");
	});

	it("should parse env() tag", async () => {
		const { data } = await parse('env_val = env("TEST_VAR")', {
			env: { TEST_VAR: "test_value" },
		});
		assert.deepStrictEqual(data, { env_val: "test_value" });
	});

	it("should reject env() for undefined variable", async () => {
		await assertThrows('val = env("UNDEFINED")', "no environment variable 'UNDEFINED' is set");
	});

	it("should parse string() tag with number", async () => {
		const { data } = await parse("val = string(123)");
		assert.deepStrictEqual(data, { val: "123" });
	});

	it("should parse string() tag with boolean", async () => {
		const { data } = await parse("val1 = string(true)\nval2 = string(false)");
		assert.deepStrictEqual(data, { val1: "true", val2: "false" });
	});

	it("should parse string() tag with null", async () => {
		const { data } = await parse("val = string(null)");
		assert.deepStrictEqual(data, { val: "null" });
	});

	it("should parse string() tag with string (no-op)", async () => {
		const { data } = await parse('val = string("text")');
		assert.deepStrictEqual(data, { val: "text" });
	});

	it("should parse number() tag with string", async () => {
		const { data } = await parse('val = number("123")');
		assert.deepStrictEqual(data, { val: 123 });
	});

	it("should parse number() tag with boolean", async () => {
		const { data } = await parse("val1 = number(true)\nval2 = number(false)");
		assert.deepStrictEqual(data, { val1: 1, val2: 0 });
	});

	it("should parse number() tag with null", async () => {
		const { data } = await parse("val = number(null)");
		assert.deepStrictEqual(data, { val: 0 });
	});

	it("should reject number() with invalid string", async () => {
		await assertThrows('val = number("not a number")', "invalid number");
	});

	it("should parse int() tag with float", async () => {
		const { data } = await parse("val = int(3.7)");
		assert.deepStrictEqual(data, { val: 3 });
	});

	it("should parse int() tag with string float", async () => {
		const { data } = await parse('val = int("123.456")');
		assert.deepStrictEqual(data, { val: 123 });
	});

	it("should parse int() tag with exponent", async () => {
		const { data } = await parse("val = int(456.321e2)");
		assert.deepStrictEqual(data, { val: 45632 });
	});

	it("should parse float() tag with integer", async () => {
		const { data } = await parse("val = float(42)");
		assert.deepStrictEqual(data, { val: 42.0 });
	});

	it("should parse float() tag with string", async () => {
		const { data } = await parse('val = float("3.14")');
		assert.deepStrictEqual(data, { val: 3.14 });
	});

	it("should parse bool() tag with number", async () => {
		const { data } = await parse("val1 = bool(1)\nval2 = bool(0)\nval3 = bool(-5)");
		assert.deepStrictEqual(data, { val1: true, val2: false, val3: true });
	});

	it("should parse bool() tag with string", async () => {
		const { data } = await parse('val1 = bool("text")\nval2 = bool("")');
		assert.deepStrictEqual(data, { val1: true, val2: false });
	});

	it("should parse bool() tag with null", async () => {
		const { data } = await parse("val = bool(null)");
		assert.deepStrictEqual(data, { val: false });
	});

	it("should serialize unrecognized tags as tuples", async () => {
		const { data } = await parse('val = custom_tag("arg")');
		assert.deepStrictEqual(data, { val: ["custom_tag", "arg"] });
	});

	it("should serialize unrecognized tags with key paths", async () => {
		const { data } = await parse("val = custom_tag(foo.bar)");
		assert.deepStrictEqual(data, { val: ["custom_tag", "foo.bar"] });
	});

	it("should use resolved tags in embedded values", async () => {
		const { data } = await parse('str = "value: ${string(123)}"');
		assert.deepStrictEqual(data, { str: "value: 123" });
	});

	it("should reject tags returning objects in embedded values", async () => {
		await assertThrows(
			'val = "text ${custom_tag({ a = 1 })}"',
			"tags must resolve to a primitive in embedded values",
		);
	});
});

describe("Statements", () => {
	it("should parse simple statement", async () => {
		const { data } = await parse('allow from "192.168.1.1"');
		assert.deepStrictEqual(data, { allow: [["from", "192.168.1.1"]] });
	});

	it("should parse multiple statements with same key", async () => {
		const { data } = await parse('allow from "192.168.1.1"\nallow from "10.0.0.0/8"');
		assert.deepStrictEqual(data, {
			allow: [
				["from", "192.168.1.1"],
				["from", "10.0.0.0/8"],
			],
		});
	});

	it("should parse statements with mixed value types", async () => {
		const { data } = await parse("command execute true 123 null");
		assert.deepStrictEqual(data, { command: [["execute", true, 123, null]] });
	});

	it("should parse statements with objects", async () => {
		const { data } = await parse("config load { debug = true }");
		assert.deepStrictEqual(data, { config: [["load", { debug: true }]] });
	});

	it("should parse statements with arrays", async () => {
		const { data } = await parse("data set [1, 2, 3]");
		assert.deepStrictEqual(data, { data: [["set", [1, 2, 3]]] });
	});

	it("should parse unquoted string values in statements", async () => {
		const { data } = await parse("allow from localhost");
		assert.deepStrictEqual(data, { allow: [["from", "localhost"]] });
	});

	it("should prioritize known types over unquoted strings", async () => {
		const { data } = await parse("config true false null 123");
		assert.deepStrictEqual(data, { config: [[true, false, null, 123]] });
	});

	it("should reject keys as statement values", async () => {
		await assertThrows("allow a.b.c", "dotted keys are not allowed");
	});

	it("should handle statements in objects", async () => {
		const { data } = await parse("obj { allow from localhost }");
		assert.deepStrictEqual(data, { obj: { allow: [["from", "localhost"]] } });
	});
});

describe("Complex Scenarios", () => {
	it("should parse nested structures", async () => {
		const { data } = await parse(`
      app {
        name = "MyApp"
        server {
          host = "localhost"
          port = 8080
          ssl = true
        }
        database {
          url = "postgresql://localhost/mydb"
        }
      }
    `);
		assert.deepStrictEqual(data, {
			app: {
				name: "MyApp",
				server: { host: "localhost", port: 8080, ssl: true },
				database: { url: "postgresql://localhost/mydb" },
			},
		});
	});

	it("should handle mixed operators on same key", async () => {
		const { data } = await parse('list << "a"\nlist << "b"');
		assert.deepStrictEqual(data, { list: ["a", "b"] });
	});

	it("should handle variables with complex values", async () => {
		const { data } = await parse("$config = { port = 8080 }\nserver = $config");
		assert.deepStrictEqual(data, { server: { port: 8080 } });
	});

	it("should parse document with comments", async () => {
		const { data } = await parse(`
      // This is a comment
      key = "value" // inline comment
      // Another comment
      number = 42
    `);
		assert.deepStrictEqual(data, { key: "value", number: 42 });
	});

	it("should handle empty lines", async () => {
		const { data } = await parse("key1 = 1\n\n\nkey2 = 2\n\n");
		assert.deepStrictEqual(data, { key1: 1, key2: 2 });
	});

	it("should parse complex key paths", async () => {
		const { data } = await parse('a.b[0].c."d e" = 1');
		assert.deepStrictEqual(data, { a: { b: [{ c: { "d e": 1 } }] } });
	});

	it("should handle tag in array", async () => {
		const { data } = await parse("server.port = 8080\narr = [ref(server.port)]");
		assert.deepStrictEqual(data, { server: { port: 8080 }, arr: [8080] });
	});

	it("should handle variable in array", async () => {
		const { data } = await parse("$val = 42\narr = [$val]");
		assert.deepStrictEqual(data, { arr: [42] });
	});

	it("should parse mixed inline and block format", async () => {
		const { data } = await parse(`
      obj1 = { a = 1, b = 2 }
      obj2 {
        c = 3
        d = 4
      }
    `);
		assert.deepStrictEqual(data, { obj1: { a: 1, b: 2 }, obj2: { c: 3, d: 4 } });
	});
});

describe("Edge Cases", () => {
	it("should handle empty input", async () => {
		const { data } = await parse("");
		assert.deepStrictEqual(data, {});
	});

	it("should handle only comments", async () => {
		const { data } = await parse("// just a comment");
		assert.deepStrictEqual(data, {});
	});

	it("should handle only whitespace and newlines", async () => {
		const { data } = await parse("\n\n  \t  \n\n");
		assert.deepStrictEqual(data, {});
	});

	it("should handle very deep nesting", async () => {
		const { data } = await parse("a.b.c.d.e.f.g.h.i.j = 1");
		assert.deepStrictEqual(data, {
			a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 1 } } } } } } } } },
		});
	});

	it("should handle long variable names", async () => {
		const longName = "$" + "a".repeat(100);
		const { data } = await parse(`${longName} = 1\nkey = ${longName}`);
		assert.deepStrictEqual(data, { key: 1 });
	});

	it("should handle large numbers", async () => {
		const { data } = await parse("big = 999999999999999");
		assert.deepStrictEqual(data, { big: 999999999999999 });
	});

	it("should handle very small floats", async () => {
		const { data } = await parse("small = 0.000000001");
		assert.deepStrictEqual(data, { small: 0.000000001 });
	});

	it("should handle -0.0 and +0.0", async () => {
		const { data } = await parse("neg_zero = -0.0\npos_zero = +0.0");
		assert.deepStrictEqual(data, { neg_zero: -0.0, pos_zero: 0.0 });
	});

	it("should handle deeply nested embedded values", async () => {
		const { data } = await parse('$a = "A"\n$b = "${$a}B"\n$c = "${$b}C"\nresult = "${$c}D"');
		assert.deepStrictEqual(data, { result: "ABCD" });
	});

	it("should handle empty object in array", async () => {
		const { data } = await parse("arr = [{}, {}]");
		assert.deepStrictEqual(data, { arr: [{}, {}] });
	});

	it("should handle empty array in object", async () => {
		const { data } = await parse("obj = { arr = [] }");
		assert.deepStrictEqual(data, { obj: { arr: [] } });
	});

	it("should overwrite non-array with append", async () => {
		const { data } = await parse('key = "string"\nkey << 1');
		assert.deepStrictEqual(data, { key: [1] });
	});

	it("should handle consecutive newlines in arrays", async () => {
		const { data } = await parse("arr = [\n\n\n1\n\n\n2\n\n\n]");
		assert.deepStrictEqual(data, { arr: [1, 2] });
	});

	it("should handle consecutive newlines in objects", async () => {
		const { data } = await parse("obj = {\n\n\na = 1\n\n\nb = 2\n\n\n}");
		assert.deepStrictEqual(data, { obj: { a: 1, b: 2 } });
	});

	it("should parse unicode in strings", async () => {
		const { data } = await parse('str = "Hello 世界 🌍"');
		assert.deepStrictEqual(data, { str: "Hello 世界 🌍" });
	});

	it("should handle keys that look like numbers", async () => {
		const { data } = await parse("123 = true\n456 = false");
		assert.deepStrictEqual(data, { 123: true, 456: false });
	});

	it("should handle mixed positive/negative numbers", async () => {
		const { data } = await parse("arr = [+1, -2, +3, -4]");
		assert.deepStrictEqual(data, { arr: [1, -2, 3, -4] });
	});
});

describe("Custom Tags and Statements", () => {
	it("should allow custom tag resolvers", async () => {
		const { data } = await parse("val = double(5)", {
			resolvers: {
				tags: [
					{
						name: "double",
						resolver: async (ctx) => {
							const value = await ctx.next();
							if (value.success && typeof value.value === "number") {
								return value.value * 2;
							}

							throw new Error("Expected number");
						},
					},
				],
			},
		});
		assert.deepStrictEqual(data, { val: 10 });
	});

	it("should allow custom statement resolvers", async () => {
		const { data } = await parse("include config", {
			resolvers: {
				statements: [
					{
						name: "include",
						resolver: async () => {
							return { action: "collect" };
						},
					},
				],
			},
		});
		assert.deepStrictEqual(data, { include: [["config"]] });
	});

	it("should handle errors in custom tag resolvers", async () => {
		const errMessage = "FAIL TAG RESOLVER";
		await assert.rejects(
			async () =>
				await parse("val = failing_tag(1)", {
					resolvers: {
						tags: [
							{
								name: "failing_tag",
								resolver: () => {
									throw new Error(errMessage);
								},
							},
						],
					},
				}),
			(err) => {
				assert.ok(err instanceof BconfError);
				assert.ok(
					err.message.includes(errMessage),
					`Expected error message to include "${errMessage}", got "${err.message}"`,
				);

				return true;
			},
		);
	});

	it("should handle errors in custom statement resolvers", async () => {
		const parsePromise = parse("failing_stmt test", {
			resolvers: {
				statements: [
					{
						name: "failing_stmt",
						resolver: async () => {
							throw new Error("Custom error");
						},
					},
				],
			},
		});
		await assert.rejects(parsePromise, /Custom error/);
	});
});

describe("Statement Resolvers (import/export/extends)", () => {
	it("should handle extends statement with merge action", async () => {
		const { data } = await parse('extends "./base.bconf"\nkey = 2', {
			resolvers: {
				statements: [
					{
						name: "extends",
						resolver: async () => {
							return { action: "merge", value: { key: 1 } };
						},
					},
				],
			},
		});
		assert.deepStrictEqual(data, { key: 2 });
	});

	it("should handle statement with discard action", async () => {
		const { data } = await parse("ignored_stmt test\nkey = 1", {
			resolvers: {
				statements: [
					{
						name: "ignored_stmt",
						resolver: async () => {
							return { action: "discard" };
						},
					},
				],
			},
		});
		assert.deepStrictEqual(data, { key: 1 });
	});

	it("should reject merge of non-object values", async () => {
		const errMessage = "cannot merge non object value";
		await assert.rejects(
			async () =>
				await parse("stmt test", {
					resolvers: {
						statements: [
							{
								name: "stmt",
								// @ts-expect-error actually want to test when the value is not what is expected
								resolver: async () => {
									return { action: "merge", value: ["test"] };
								},
							},
						],
					},
				}),
			(err) => {
				assert.ok(err instanceof BconfError);
				assert.ok(
					err.message.includes(errMessage),
					`Expected error message to include "${errMessage}", got "${err.message}"`,
				);

				return true;
			},
		);
	});
});

describe("Variable Scoping", () => {
	it("should isolate variables in nested objects", async () => {
		const { data } = await parse(`
      $global = "global"
      outer {
        $local = "local"
        inner {
          key1 = $global
          key2 = $local
        }
      }
    `);
		assert.deepStrictEqual(data, {
			outer: { inner: { key1: "global", key2: "local" } },
		});
	});

	it("should shadow parent variables", async () => {
		const { data } = await parse(`
      $var = "outer"
      obj1 {
        key1 = $var
        $var = "inner"
        key2 = $var
      }
      key3 = $var
    `);
		assert.deepStrictEqual(data, {
			obj1: { key1: "outer", key2: "inner" },
			key3: "outer",
		});
	});

	it("should not leak variables from child scopes", async () => {
		await assertThrows(
			`
      obj {
        $local = 1
      }
      key = $local
    `,
			"could not resolve variable",
		);
	});

	it("should allow sibling scopes to have same variable names", async () => {
		const { data } = await parse(`
      obj1 {
        $local = 1
        key = $local
      }
      obj2 {
        $local = 2
        key = $local
      }
    `);
		assert.deepStrictEqual(data, { obj1: { key: 1 }, obj2: { key: 2 } });
	});
});

describe("Number Parsing Edge Cases", () => {
	it("should parse zero", async () => {
		const { data } = await parse("zero = 0");
		assert.deepStrictEqual(data, { zero: 0 });
	});

	it("should parse negative zero", async () => {
		const { data } = await parse("neg_zero = -0");
		assert.strictEqual(data.neg_zero, -0);
	});

	it("should reject consecutive underscores", async () => {
		await assertThrows("num = 1__000", "cannot have consecutive underscores for number");
	});

	it("should reject leading underscore", async () => {
		await assertThrows("num = _1000", "unexpected identifier as value");
	});

	it("should reject trailing underscore", async () => {
		await assertThrows("num = 1000_", "cannot have leading or trailing underscores for number");
	});

	it("should parse scientific notation with capitals", async () => {
		const { data } = await parse("num = 1.23E10");
		assert.strictEqual(data.num, 1.23e10);
	});

	it("should parse scientific notation with explicit positive exponent", async () => {
		const { data } = await parse("num = 2e+2");
		assert.strictEqual(data.num, 2e2);
	});

	it("should handle float with exponent but no fraction", async () => {
		const { data } = await parse("num = 123e4");
		assert.strictEqual(data.num, 123e4);
	});
});

describe("Tag Conversion Edge Cases", () => {
	it("should convert variable to string via string() tag", async () => {
		const { data } = await parse("$num = 42\nstr = string($num)");
		assert.deepStrictEqual(data, { str: "42" });
	});

	it("should convert float string with underscores via int()", async () => {
		const { data } = await parse('val = int("-123_456")');
		assert.deepStrictEqual(data, { val: -123456 });
	});

	it("should convert string integer via float()", async () => {
		const { data } = await parse('val = float("123")');
		assert.deepStrictEqual(data, { val: 123.0 });
	});

	it("should handle bool() with -0.0", async () => {
		const { data } = await parse("val = bool(-0.0)");
		assert.deepStrictEqual(data, { val: false });
	});

	it("should handle number() inferring float type", async () => {
		const { data } = await parse('val = number("1.5")');
		assert.strictEqual(data.val, 1.5);
	});

	it("should handle number() inferring integer type", async () => {
		const { data } = await parse('val = number("42")');
		assert.strictEqual(data.val, 42);
	});

	it("should handle number() with scientific notation string", async () => {
		const { data } = await parse('val = number("123.321e10")');
		assert.strictEqual(data.val, 123.321e10);
	});
});

describe("Statement Args Edge Cases", () => {
	it("should handle empty statement (just key)", async () => {
		const { data } = await parse("stmt");
		assert.deepStrictEqual(data, { stmt: true });
	});

	it("should reject trailing comma in root", async () => {
		await assertThrows("key = 1,", "commas are only allowed in objects and arrays");
	});

	it("should handle statement with variable", async () => {
		const { data } = await parse("$val = 42\nstmt test $val");
		assert.deepStrictEqual(data, { stmt: [["test", 42]] });
	});

	it("should handle statement with tag", async () => {
		const { data } = await parse("stmt test string(123)");
		assert.deepStrictEqual(data, { stmt: [["test", "123"]] });
	});

	it("should parse statement with quoted strings", async () => {
		const { data } = await parse('stmt "arg1" "arg2"');
		assert.deepStrictEqual(data, { stmt: [["arg1", "arg2"]] });
	});

	it("should mix quoted and unquoted strings in statements", async () => {
		const { data } = await parse('stmt unquoted "quoted" another');
		assert.deepStrictEqual(data, { stmt: [["unquoted", "quoted", "another"]] });
	});
});

describe("Array Index Assignment Edge Cases", () => {
	it("should overwrite existing array value", async () => {
		const { data } = await parse("arr[0] = 1\narr[0] = 2");
		assert.deepStrictEqual(data, { arr: [2] });
	});

	it("should expand array when assigning to high index", async () => {
		const { data } = await parse('arr[5] = "X"');
		assert.deepStrictEqual(data, { arr: [null, null, null, null, null, "X"] });
	});

	it("should handle sparse arrays", async () => {
		const { data } = await parse("arr[0] = 1\narr[2] = 3");
		assert.deepStrictEqual(data, { arr: [1, null, 3] });
	});

	it("should handle 3D array indexing", async () => {
		const { data } = await parse("arr[0][0][0] = 1");
		assert.deepStrictEqual(data, { arr: [[[1]]] });
	});

	it("should mix dotted keys and array indexes", async () => {
		const { data } = await parse("a[0].b[1].c = 2");
		assert.deepStrictEqual(data, { a: [{ b: [null, { c: 2 }] }] });
	});
});

describe("String Edge Cases", () => {
	it("should handle empty multi-line strings", async () => {
		const { data } = await parse('str = """"""');
		assert.deepStrictEqual(data, { str: "" });
	});

	it("should handle strings with only escape sequences", async () => {
		const { data } = await parse('str = "\\n\\t\\r"');
		assert.deepStrictEqual(data, { str: "\n\t\r" });
	});

	it("should handle back-to-back escape sequences", async () => {
		const { data } = await parse('str = "\\n\\n\\n"');
		assert.deepStrictEqual(data, { str: "\n\n\n" });
	});

	it("should handle embedded value with string", async () => {
		const { data } = await parse('str = "${"nested"}"');
		assert.deepStrictEqual(data, { str: "nested" });
	});

	it("should handle very long strings", async () => {
		const longStr = "a".repeat(10000);
		const { data } = await parse(`str = "${longStr}"`);
		assert.strictEqual(data.str, longStr);
	});
});

describe("Object and Array Formatting", () => {
	it("should handle objects with only newlines", async () => {
		const { data } = await parse("obj = {\n\n\n}");
		assert.deepStrictEqual(data, { obj: {} });
	});

	it("should handle arrays with only newlines", async () => {
		const { data } = await parse("arr = [\n\n\n]");
		assert.deepStrictEqual(data, { arr: [] });
	});

	it("should handle mixed comma and newline separators in objects", async () => {
		const { data } = await parse("obj = {\n  a = 1,\n  b = 2\n  c = 3,\n}");
		assert.deepStrictEqual(data, { obj: { a: 1, b: 2, c: 3 } });
	});

	it("should handle mixed comma and newline separators in arrays", async () => {
		const { data } = await parse("arr = [\n  1,\n  2\n  3,\n]");
		assert.deepStrictEqual(data, { arr: [1, 2, 3] });
	});

	it("should handle single-line object with multiple keys", async () => {
		const { data } = await parse("obj = { a = 1, b = 2, c = 3, d = 4, e = 5 }");
		assert.deepStrictEqual(data, { obj: { a: 1, b: 2, c: 3, d: 4, e: 5 } });
	});
});

describe("Error Reporting", () => {
	it("should report error with token information", async () => {
		try {
			await parse("key = invalid+");
			assert.fail("Should have thrown");
		} catch (err) {
			assert.ok(err instanceof BconfError);
			assert.ok(err.row);
			assert.ok(err.column);
		}
	});

	it("should report error for unclosed embedded value", async () => {
		// invalid number since embedded values can only have primitive values, so
		// this identifier is treated as a number always (since its not a tag identifier)
		await assertThrows('"${unclosed', "invalid number");
	});

	it("should report meaningful error for invalid operator", async () => {
		await assertThrows("key < 5", "unexpected operator");
	});
});

describe("Integration Tests", () => {
	it("should parse realistic config file", async () => {
		const config = `
      // Application configuration
      app {
        name = "MyApp"
        version = "1.0.0"
        debug = true
      }

      // Server settings
      $default_port = 8080
      server {
        host = "0.0.0.0"
        port = $default_port
        ssl = false
        
        cors {
          enabled = true
          origins << "http://localhost:3000"
          origins << "https://example.com"
        }
      }

      // Database configuration
      database {
        url = "postgresql://localhost/mydb"
        pool_size = 10
        timeout = float(30)
      }

      // Feature flags
      features {
        new_ui
        beta_features = false
      }
    `;

		const { data } = await parse(config);
		assert.deepStrictEqual(data, {
			app: {
				name: "MyApp",
				version: "1.0.0",
				debug: true,
			},
			server: {
				host: "0.0.0.0",
				port: 8080,
				ssl: false,
				cors: {
					enabled: true,
					origins: ["http://localhost:3000", "https://example.com"],
				},
			},
			database: {
				url: "postgresql://localhost/mydb",
				pool_size: 10,
				timeout: 30.0,
			},
			features: {
				new_ui: true,
				beta_features: false,
			},
		});
	});

	it("should parse complex nested structure with all features", async () => {
		const input = `
      $version = "2.0"
      
      app {
        name = "Test"
        version = $version
        metadata {
          tags = ["prod", "api"]
          config {
            enabled = true
            items[0] = { key = "value" }
          }
        }
      }

      settings.api.endpoints[0] = "https://api.example.com"
      settings.api.timeout = int(30.5)
      
      allow from localhost
      allow from "192.168.1.0/24"
    `;

		const { data } = await parse(input);
		assert.deepStrictEqual(data, {
			app: {
				name: "Test",
				version: "2.0",
				metadata: {
					tags: ["prod", "api"],
					config: {
						enabled: true,
						items: [{ key: "value" }],
					},
				},
			},
			settings: {
				api: {
					endpoints: ["https://api.example.com"],
					timeout: 30,
				},
			},
			allow: [
				["from", "localhost"],
				["from", "192.168.1.0/24"],
			],
		});
	});
});
