import { describe, it } from "node:test";
import assert from "node:assert";
import { parse } from "./parse.js";
import { BconfError } from "./error.js";

/**
 * Helper to assert that parsing throws an error
 * @param {string} input
 * @param {string=} messageMatch
 * @param {import("./types.js").ParseOptions=} opts
 */
async function assertThrows(input, messageMatch, opts) {
	await assert.rejects(
		async () => await parse(input, opts),
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

describe("ref() Tag Resolver", () => {
	it("should resolve reference to existing key", async () => {
		const result = await parse("foo = 123\nbar = ref(foo)");
		assert.deepStrictEqual(result, { foo: 123, bar: 123 });
	});

	it("should resolve reference to nested key", async () => {
		const result = await parse("server.port = 8080\ndefault = ref(server.port)");
		assert.deepStrictEqual(result, { server: { port: 8080 }, default: 8080 });
	});

	it("should resolve reference to deeply nested key", async () => {
		const result = await parse("a.b.c.d = 42\nvalue = ref(a.b.c.d)");
		assert.deepStrictEqual(result, { a: { b: { c: { d: 42 } } }, value: 42 });
	});

	it("should resolve reference to array element", async () => {
		const result = await parse("arr = [1, 2, 3]\nvalue = ref(arr[1])");
		assert.deepStrictEqual(result, { arr: [1, 2, 3], value: 2 });
	});

	it("should resolve reference to object in array", async () => {
		const result = await parse("arr = [{ key = 123 }]\nvalue = ref(arr[0].key)");
		assert.deepStrictEqual(result, { arr: [{ key: 123 }], value: 123 });
	});

	it("should resolve reference to string value", async () => {
		const result = await parse('str = "hello"\nvalue = ref(str)');
		assert.deepStrictEqual(result, { str: "hello", value: "hello" });
	});

	it("should resolve reference to boolean", async () => {
		const result = await parse("flag = true\nvalue = ref(flag)");
		assert.deepStrictEqual(result, { flag: true, value: true });
	});

	it("should resolve reference to null", async () => {
		const result = await parse("empty = null\nvalue = ref(empty)");
		assert.deepStrictEqual(result, { empty: null, value: null });
	});

	it("should resolve reference to object", async () => {
		const result = await parse("obj = { a = 1 }\nvalue = ref(obj)");
		assert.deepStrictEqual(result, { obj: { a: 1 }, value: { a: 1 } });
	});

	it("should resolve reference to array", async () => {
		const result = await parse("arr = [1, 2]\nvalue = ref(arr)");
		assert.deepStrictEqual(result, { arr: [1, 2], value: [1, 2] });
	});

	it("should reject reference to undefined key", async () => {
		await assertThrows("value = ref(undefined)", "no value exists at key");
	});

	it("should reject reference to undefined nested key", async () => {
		await assertThrows("foo = 1\nvalue = ref(foo.bar)", "no value exists at key");
	});

	it("should reject ref without argument", async () => {
		await assertThrows("value = ref()", "expected key path for 'ref' tag");
	});

	it("should reject ref with non-keypath argument", async () => {
		await assertThrows('value = ref("string")', "expected key path for 'ref' tag");
	});

	it("should reject ref with number argument", async () => {
		await assertThrows("value = ref(123)", "no value exists at key '123'");
	});

	it("should reject ref for key not defined before use", async () => {
		await assertThrows("value = ref(foo)\nfoo = 123", "no value exists at key 'foo'");
	});

	it("should resolve reference used in array", async () => {
		const result = await parse("foo = 42\narr = [ref(foo), ref(foo)]");
		assert.deepStrictEqual(result, { foo: 42, arr: [42, 42] });
	});

	it("should resolve reference used in object", async () => {
		const result = await parse("port = 8080\nserver = { port = ref(port) }");
		assert.deepStrictEqual(result, { port: 8080, server: { port: 8080 } });
	});

	it("should resolve reference with numeric key", async () => {
		const result = await parse("123 = 456\nvalue = ref(123)");
		assert.deepStrictEqual(result, { 123: 456, value: 456 });
	});
});

describe("env() Tag Resolver", () => {
	it("should resolve environment variable", async () => {
		const result = await parse('value = env("TEST_VAR")', {
			env: { TEST_VAR: "test_value" },
		});
		assert.deepStrictEqual(result, { value: "test_value" });
	});

	it("should resolve numeric environment variable", async () => {
		const result = await parse('value = env("PORT")', {
			env: { PORT: "8080" },
		});
		assert.deepStrictEqual(result, { value: "8080" });
	});

	it("should resolve empty string environment variable", async () => {
		const result = await parse('value = env("EMPTY")', {
			env: { EMPTY: "" },
		});
		assert.deepStrictEqual(result, { value: "" });
	});

	it("should reject undefined environment variable", async () => {
		await assertThrows(
			'value = env("UNDEFINED")',
			"no environment variable 'UNDEFINED' is set",
		);
	});

	it("should reject env without argument", async () => {
		await assertThrows("value = env()", "expected a string value for 'env' tag");
	});

	it("should reject env with non-string argument", async () => {
		await assertThrows("value = env(123)", "expected a string value for 'env' tag");
	});

	it("should reject env with boolean argument", async () => {
		await assertThrows("value = env(true)", "expected a string value for 'env' tag");
	});

	it("should resolve environment variable with special characters", async () => {
		const result = await parse('value = env("VAR_NAME_123")', {
			env: { VAR_NAME_123: "value" },
		});
		assert.deepStrictEqual(result, { value: "value" });
	});

	it("should use environment variable in embedded value", async () => {
		const result = await parse('str = "Port: ${env("PORT")}"', {
			env: { PORT: "3000" },
		});
		assert.deepStrictEqual(result, { str: "Port: 3000" });
	});

	it("should use environment variable in array", async () => {
		const result = await parse('arr = [env("VAR1"), env("VAR2")]', {
			env: { VAR1: "a", VAR2: "b" },
		});
		assert.deepStrictEqual(result, { arr: ["a", "b"] });
	});
});

describe("string() Tag Resolver", () => {
	it("should convert number to string", async () => {
		const result = await parse("value = string(123)");
		assert.deepStrictEqual(result, { value: "123" });
	});

	it("should convert negative number to string", async () => {
		const result = await parse("value = string(-456)");
		assert.deepStrictEqual(result, { value: "-456" });
	});

	it("should convert float to string", async () => {
		const result = await parse("value = string(3.14)");
		assert.deepStrictEqual(result, { value: "3.14" });
	});

	it("should convert true to string", async () => {
		const result = await parse("value = string(true)");
		assert.deepStrictEqual(result, { value: "true" });
	});

	it("should convert false to string", async () => {
		const result = await parse("value = string(false)");
		assert.deepStrictEqual(result, { value: "false" });
	});

	it("should convert null to string", async () => {
		const result = await parse("value = string(null)");
		assert.deepStrictEqual(result, { value: "null" });
	});

	it("should keep string as string", async () => {
		const result = await parse('value = string("hello")');
		assert.deepStrictEqual(result, { value: "hello" });
	});

	it("should convert zero to string", async () => {
		const result = await parse("value = string(0)");
		assert.deepStrictEqual(result, { value: "0" });
	});

	it("should convert negative zero to string", async () => {
		const result = await parse("value = string(-0)");
		assert.deepStrictEqual(result, { value: "0" });
	});

	it("should reject string conversion of object", async () => {
		await assertThrows("value = string({ a = 1 })", "cannot convert value to string");
	});

	it("should reject string conversion of array", async () => {
		await assertThrows("value = string([1, 2])", "cannot convert value to string");
	});

	it("should reject string without argument", async () => {
		await assertThrows("value = string()", "expected a value for 'string' tag");
	});

	it("should convert variable to string", async () => {
		const result = await parse("$num = 42\nvalue = string($num)");
		assert.deepStrictEqual(result, { value: "42" });
	});

	it("should use string() in embedded value", async () => {
		const result = await parse('str = "Number: ${string(123)}"');
		assert.deepStrictEqual(result, { str: "Number: 123" });
	});
});

describe("number() Tag Resolver", () => {
	it("should convert string to number", async () => {
		const result = await parse('value = number("123")');
		assert.deepStrictEqual(result, { value: 123 });
	});

	it("should convert negative string to number", async () => {
		const result = await parse('value = number("-456")');
		assert.deepStrictEqual(result, { value: -456 });
	});

	it("should convert float string to number", async () => {
		const result = await parse('value = number("3.14")');
		assert.deepStrictEqual(result, { value: 3.14 });
	});

	it("should convert string with underscores to number", async () => {
		const result = await parse('value = number("1_000_000")');
		assert.deepStrictEqual(result, { value: 1000000 });
	});

	it("should convert string with exponent to number", async () => {
		const result = await parse('value = number("1.23e10")');
		assert.strictEqual(result.value, 1.23e10);
	});

	it("should convert true to 1", async () => {
		const result = await parse("value = number(true)");
		assert.deepStrictEqual(result, { value: 1 });
	});

	it("should convert false to 0", async () => {
		const result = await parse("value = number(false)");
		assert.deepStrictEqual(result, { value: 0 });
	});

	it("should convert null to 0", async () => {
		const result = await parse("value = number(null)");
		assert.deepStrictEqual(result, { value: 0 });
	});

	it("should keep number as number", async () => {
		const result = await parse("value = number(42)");
		assert.deepStrictEqual(result, { value: 42 });
	});

	it("should reject invalid number string", async () => {
		await assertThrows('value = number("not a number")', "invalid number");
	});

	it("should reject empty string", async () => {
		await assertThrows('value = number("")', "invalid number");
	});

	it("should reject number conversion of object", async () => {
		await assertThrows("value = number({ a = 1 })", "cannot convert value to number");
	});

	it("should reject number conversion of array", async () => {
		await assertThrows("value = number([1, 2])", "cannot convert value to number");
	});

	it("should reject number without argument", async () => {
		await assertThrows("value = number()", "expected value for 'number' tag");
	});

	it("should reject string with leading underscore", async () => {
		await assertThrows('value = number("_123")', "cannot have leading or trailing underscores");
	});

	it("should reject string with trailing underscore", async () => {
		await assertThrows('value = number("123_")', "cannot have leading or trailing underscores");
	});

	it("should reject string with consecutive underscores", async () => {
		await assertThrows('value = number("1__000")', "cannot have consecutive underscores");
	});

	it("should convert variable to number", async () => {
		const result = await parse('$str = "456"\nvalue = number($str)');
		assert.deepStrictEqual(result, { value: 456 });
	});
});

describe("int() Tag Resolver", () => {
	it("should truncate float to integer", async () => {
		const result = await parse("value = int(3.7)");
		assert.deepStrictEqual(result, { value: 3 });
	});

	it("should truncate negative float to integer", async () => {
		const result = await parse("value = int(-3.7)");
		assert.deepStrictEqual(result, { value: -3 });
	});

	it("should keep integer as integer", async () => {
		const result = await parse("value = int(42)");
		assert.deepStrictEqual(result, { value: 42 });
	});

	it("should convert string to integer", async () => {
		const result = await parse('value = int("123")');
		assert.deepStrictEqual(result, { value: 123 });
	});

	it("should convert float string to integer", async () => {
		const result = await parse('value = int("123.456")');
		assert.deepStrictEqual(result, { value: 123 });
	});

	it("should convert string with underscores to integer", async () => {
		const result = await parse('value = int("1_000_000")');
		assert.deepStrictEqual(result, { value: 1000000 });
	});

	it("should convert exponent to integer", async () => {
		const result = await parse("value = int(1.5e2)");
		assert.deepStrictEqual(result, { value: 150 });
	});

	it("should truncate toward zero for positive numbers", async () => {
		const result = await parse("value = int(9.9)");
		assert.deepStrictEqual(result, { value: 9 });
	});

	it("should truncate toward zero for negative numbers", async () => {
		const result = await parse("value = int(-9.9)");
		assert.deepStrictEqual(result, { value: -9 });
	});

	it("should convert true to 1", async () => {
		const result = await parse("value = int(true)");
		assert.deepStrictEqual(result, { value: 1 });
	});

	it("should convert false to 0", async () => {
		const result = await parse("value = int(false)");
		assert.deepStrictEqual(result, { value: 0 });
	});

	it("should convert null to 0", async () => {
		const result = await parse("value = int(null)");
		assert.deepStrictEqual(result, { value: 0 });
	});

	it("should reject invalid integer string", async () => {
		await assertThrows('value = int("not a number")', "invalid number");
	});

	it("should reject int conversion of object", async () => {
		await assertThrows("value = int({ a = 1 })", "cannot convert value to integer");
	});

	it("should reject int conversion of array", async () => {
		await assertThrows("value = int([1, 2])", "cannot convert value to integer");
	});

	it("should reject int without argument", async () => {
		await assertThrows("value = int()", "expected value for 'int' tag");
	});

	it("should handle zero", async () => {
		const result = await parse("value = int(0)");
		assert.deepStrictEqual(result, { value: 0 });
	});

	it("should handle negative zero", async () => {
		const result = await parse("value = int(-0.0)");
		assert.deepStrictEqual(result, { value: -0 });
	});
});

describe("float() Tag Resolver", () => {
	it("should convert integer to float", async () => {
		const result = await parse("value = float(42)");
		assert.deepStrictEqual(result, { value: 42.0 });
	});

	it("should keep float as float", async () => {
		const result = await parse("value = float(3.14)");
		assert.deepStrictEqual(result, { value: 3.14 });
	});

	it("should convert string to float", async () => {
		const result = await parse('value = float("123.456")');
		assert.deepStrictEqual(result, { value: 123.456 });
	});

	it("should convert integer string to float", async () => {
		const result = await parse('value = float("42")');
		assert.deepStrictEqual(result, { value: 42.0 });
	});

	it("should convert string with underscores to float", async () => {
		const result = await parse('value = float("1_000.5")');
		assert.deepStrictEqual(result, { value: 1000.5 });
	});

	it("should convert string with exponent to float", async () => {
		const result = await parse('value = float("1.5e2")');
		assert.deepStrictEqual(result, { value: 1.5e2 });
	});

	it("should convert true to 1.0", async () => {
		const result = await parse("value = float(true)");
		assert.deepStrictEqual(result, { value: 1.0 });
	});

	it("should convert false to 0.0", async () => {
		const result = await parse("value = float(false)");
		assert.deepStrictEqual(result, { value: 0.0 });
	});

	it("should convert null to 0.0", async () => {
		const result = await parse("value = float(null)");
		assert.deepStrictEqual(result, { value: 0.0 });
	});

	it("should reject invalid float string", async () => {
		await assertThrows('value = float("not a number")', "invalid number");
	});

	it("should reject float conversion of object", async () => {
		await assertThrows("value = float({ a = 1 })", "cannot convert value to float");
	});

	it("should reject float conversion of array", async () => {
		await assertThrows("value = float([1, 2])", "cannot convert value to float");
	});

	it("should reject float without argument", async () => {
		await assertThrows("value = float()", "expected value for 'int' tag");
	});

	it("should handle zero", async () => {
		const result = await parse("value = float(0)");
		assert.deepStrictEqual(result, { value: 0.0 });
	});

	it("should handle negative zero", async () => {
		const result = await parse("value = float(-0)");
		assert.deepStrictEqual(result, { value: -0.0 });
	});

	it("should convert negative numbers", async () => {
		const result = await parse("value = float(-123)");
		assert.deepStrictEqual(result, { value: -123.0 });
	});
});

describe("bool() Tag Resolver", () => {
	it("should keep true as true", async () => {
		const result = await parse("value = bool(true)");
		assert.deepStrictEqual(result, { value: true });
	});

	it("should keep false as false", async () => {
		const result = await parse("value = bool(false)");
		assert.deepStrictEqual(result, { value: false });
	});

	it("should convert null to false", async () => {
		const result = await parse("value = bool(null)");
		assert.deepStrictEqual(result, { value: false });
	});

	it("should convert non-zero number to true", async () => {
		const result = await parse("value = bool(42)");
		assert.deepStrictEqual(result, { value: true });
	});

	it("should convert negative number to true", async () => {
		const result = await parse("value = bool(-1)");
		assert.deepStrictEqual(result, { value: true });
	});

	it("should convert zero to false", async () => {
		const result = await parse("value = bool(0)");
		assert.deepStrictEqual(result, { value: false });
	});

	it("should convert negative zero to false", async () => {
		const result = await parse("value = bool(-0.0)");
		assert.deepStrictEqual(result, { value: false });
	});

	it("should convert non-empty string to true", async () => {
		const result = await parse('value = bool("text")');
		assert.deepStrictEqual(result, { value: true });
	});

	it("should convert empty string to false", async () => {
		const result = await parse('value = bool("")');
		assert.deepStrictEqual(result, { value: false });
	});

	it("should convert float to true", async () => {
		const result = await parse("value = bool(0.1)");
		assert.deepStrictEqual(result, { value: true });
	});

	it("should reject bool conversion of object", async () => {
		await assertThrows("value = bool({ a = 1 })", "cannot convert value to boolean");
	});

	it("should reject bool conversion of array", async () => {
		await assertThrows("value = bool([1, 2])", "cannot convert value to boolean");
	});

	it("should reject bool without argument", async () => {
		await assertThrows("value = bool()", "expected value for 'int' tag");
	});

	it("should convert string '0' to true", async () => {
		const result = await parse('value = bool("0")');
		assert.deepStrictEqual(result, { value: true });
	});

	it("should convert string 'false' to true", async () => {
		const result = await parse('value = bool("false")');
		assert.deepStrictEqual(result, { value: true });
	});
});

describe("import Statement Resolver", () => {
	it("should import single variable", async () => {
		const result = await parse('import from "./file.bconf" { $var }', {
			loader: () => "export vars { $var = 123 }",
		});
		assert.deepStrictEqual(result, {});
	});

	it("should import multiple variables", async () => {
		const result = await parse('import from "./file.bconf" { $a, $b }', {
			loader: () => "$a = 1\n$b = 2\nexport vars { $a, $b }",
		});
		assert.deepStrictEqual(result, {});
	});

	it("should import variable with alias", async () => {
		const result = await parse('import from "./file.bconf" { $var as $alias }', {
			loader: () => "$var = 123\nexport vars { $var }",
		});
		assert.deepStrictEqual(result, {});
	});

	it("should import multiple variables with aliases", async () => {
		const result = await parse('import from "./file.bconf" { $a as $x, $b as $y }', {
			loader: () => "$a = 1\n$b = 2\nexport vars { $a, $b }",
		});
		assert.deepStrictEqual(result, {});
	});

	it("should import variable with multiple aliases", async () => {
		const result = await parse('import from "./file.bconf" { $var as $a, $var as $b }', {
			loader: () => "$var = 123\nexport vars { $var }",
		});
		assert.deepStrictEqual(result, {});
	});

	it("should ignore non-exported variables", async () => {
		const result = await parse('import from "./file.bconf" { $var }', {
			loader: () => "$var = 123\n$other = 456\nexport vars { $var }",
		});
		assert.deepStrictEqual(result, {});
	});

	it("should reject import without 'from' keyword", async () => {
		await assertThrows('import "./file.bconf" { $var }', "expected 'from'");
	});

	it("should reject import with invalid second argument", async () => {
		await assertThrows("import test { $var }", "expected 'from'", {
			loader: () => "$var = 1",
		});
	});

	it("should reject import without file path", async () => {
		await assertThrows("import from { $var }", "file path must be a string");
	});

	it("should reject import with non-string file path", async () => {
		await assertThrows("import from 123 { $var }", "file path must be a string");
	});

	it("should reject import with empty file path", async () => {
		await assertThrows('import from "" { $var }', "file path cannot be empty");
	});

	it("should reject import without variable list", async () => {
		await assertThrows('import from "./file.bconf"', "no such file or directory", {
			loader: () => {
				throw new Error("no such file or directory");
			},
		});
	});

	it("should reject import of non-exported variable", async () => {
		await assertThrows(
			'import from "./file.bconf" { $missing }',
			"variable '$missing' is not exported",
			{
				loader: () => "export vars { $var = 123 }",
			},
		);
	});

	it("should reject import with invalid alias syntax", async () => {
		await assertThrows(
			'import from "./file.bconf" { $var bad $alias }',
			"expected 'as' for alias statement",
			{
				loader: () => "$var = 123\nexport vars { $var }",
			},
		);
	});

	it("should reject import of already declared variable", async () => {
		await assertThrows(
			'$existing = 1\nimport from "./file.bconf" { $var as $existing }',
			"cannot be imported as it has already been declared",
			{
				loader: () => "$var = 123\nexport vars { $var }",
			},
		);
	});

	it("should allow importing false variable", async () => {
		const result = await parse('import from "./file.bconf" { $var = false }', {
			loader: () => "$var = 123\nexport vars { $var }",
		});
		assert.deepStrictEqual(result, {});
	});
});

describe("export Statement Resolver", () => {
	it("should export single variable", async () => {
		const result = await parse("$var = 123\nexport vars { $var }");
		assert.deepStrictEqual(result, {});
	});

	it("should export multiple variables", async () => {
		const result = await parse("$a = 1\n$b = 2\nexport vars { $a, $b }");
		assert.deepStrictEqual(result, {});
	});

	it("should export variable with alias", async () => {
		const result = await parse("$var = 123\nexport vars { $var as $alias }");
		assert.deepStrictEqual(result, {});
	});

	it("should export variable with multiple aliases", async () => {
		const result = await parse("$var = 123\nexport vars { $var as $a, $var as $b }");
		assert.deepStrictEqual(result, {});
	});

	it("should export inline declared variable", async () => {
		const result = await parse("export vars { $new_var }");
		assert.deepStrictEqual(result, {});
	});

	it("should export inline declared variable with alias", async () => {
		const result = await parse("export vars { $new as $alias }");
		assert.deepStrictEqual(result, {});
	});

	it("should reject export with invalid second argument", async () => {
		await assertThrows("export test { $var }", "expected 'vars'");
	});

	it("should reject export without variable list", async () => {
		await assertThrows("export vars", "expected object");
	});

	it("should reject export with non-object", async () => {
		await assertThrows("export vars 123", "expected object");
	});

	it("should reject export with invalid alias syntax", async () => {
		await assertThrows(
			"$var = 1\nexport vars { $var bad $alias }",
			"expected 'as' for alias statement",
		);
	});

	it("should ignore non-variable keys in export", async () => {
		const result = await parse("$var = 1\nexport vars { $var, regular = true }");
		assert.deepStrictEqual(result, {});
	});
});

describe("extends Statement Resolver", () => {
	it("should extend with base config", async () => {
		const result = await parse('extends "./base.bconf"\nkey2 = 2', {
			loader: () => "key1 = 1",
		});
		assert.deepStrictEqual(result, { key1: 1, key2: 2 });
	});

	it("should override base config values", async () => {
		const result = await parse('extends "./base.bconf"\nkey = 2', {
			loader: () => "key = 1",
		});
		assert.deepStrictEqual(result, { key: 2 });
	});

	it("should merge nested objects", async () => {
		const result = await parse('extends "./base.bconf"\nserver.port = 3000', {
			loader: () => 'server.host = "localhost"',
		});
		assert.deepStrictEqual(result, { server: { host: "localhost", port: 3000 } });
	});

	it("should extend deeply nested objects", async () => {
		const result = await parse('extends "./base.bconf"\na.b.c = 3', {
			loader: () => "a.b.d = 4",
		});
		assert.deepStrictEqual(result, { a: { b: { d: 4, c: 3 } } });
	});

	it("should override arrays completely", async () => {
		const result = await parse('extends "./base.bconf"\narr = [3, 4]', {
			loader: () => "arr = [1, 2]",
		});
		assert.deepStrictEqual(result, { arr: [3, 4] });
	});

	it("should override primitives completely", async () => {
		const result = await parse('extends "./base.bconf"\nvalue = 999', {
			loader: () => "value = 1",
		});
		assert.deepStrictEqual(result, { value: 999 });
	});

	it("should reject extends with non-string file path", async () => {
		await assertThrows("extends 123", "file path must be a string");
	});

	it("should handle multiple extends statements", async () => {
		const result = await parse('extends "./base1.bconf"\nextends "./base2.bconf"\nkey3 = 3', {
			loader: (_, path) => {
				if (path === "./base1.bconf") return "key1 = 1";
				if (path === "./base2.bconf") return "key2 = 2";
				return "";
			},
		});
		assert.deepStrictEqual(result, { key1: 1, key2: 2, key3: 3 });
	});

	it("should handle extends with empty base", async () => {
		const result = await parse('extends "./empty.bconf"\nkey = 1', {
			loader: () => "",
		});
		assert.deepStrictEqual(result, { key: 1 });
	});

	it("should merge complex structures", async () => {
		const result = await parse(
			'extends "./base.bconf"\nserver.ssl = true\nfeatures.beta = false',
			{
				loader: () => 'server { host = "localhost"\nport = 8080 }\nfeatures.alpha = true',
			},
		);
		assert.deepStrictEqual(result, {
			server: { host: "localhost", port: 8080, ssl: true },
			features: { alpha: true, beta: false },
		});
	});
});

describe("Combined Resolver Usage", () => {
	it("should use ref() with env()", async () => {
		const result = await parse('port = env("PORT")\ndefault = ref(port)', {
			env: { PORT: "8080" },
		});
		assert.deepStrictEqual(result, { port: "8080", default: "8080" });
	});

	it("should use string() with ref()", async () => {
		const result = await parse("num = 42\nstr = string(ref(num))");
		assert.deepStrictEqual(result, { num: 42, str: "42" });
	});

	it("should use number() with env()", async () => {
		const result = await parse('port = number(env("PORT"))', {
			env: { PORT: "8080" },
		});
		assert.deepStrictEqual(result, { port: 8080 });
	});

	it("should use int() with ref()", async () => {
		const result = await parse("value = 3.7\ntruncated = int(ref(value))");
		assert.deepStrictEqual(result, { value: 3.7, truncated: 3 });
	});

	it("should use bool() with ref()", async () => {
		const result = await parse("num = 1\nflag = bool(ref(num))");
		assert.deepStrictEqual(result, { num: 1, flag: true });
	});

	it("should chain multiple conversions", async () => {
		const result = await parse('str = "3.7"\nvalue = int(number(ref(str)))');
		assert.deepStrictEqual(result, { str: "3.7", value: 3 });
	});

	it("should use extends with ref()", async () => {
		const result = await parse('extends "./base.bconf"\ncopy = ref(original)', {
			loader: () => "original = 123",
		});
		assert.deepStrictEqual(result, { original: 123, copy: 123 });
	});

	it("should use all conversion tags in array", async () => {
		const result = await parse('arr = [string(1), number("2"), int(3.5), float(4), bool(1)]');
		assert.deepStrictEqual(result, { arr: ["1", 2, 3, 4.0, true] });
	});

	it("should use tags in embedded values", async () => {
		const result = await parse('port = 8080\nstr = "Port: ${string(ref(port))}"');
		assert.deepStrictEqual(result, { port: 8080, str: "Port: 8080" });
	});
});

describe("Resolver Edge Cases", () => {
	it("should handle ref() to value that is ref()", async () => {
		const result = await parse("a = 1\nb = ref(a)\nc = ref(b)");
		assert.deepStrictEqual(result, { a: 1, b: 1, c: 1 });
	});

	it("should handle conversion tags with variables", async () => {
		const result = await parse('$str = "123"\nnum = number($str)');
		assert.deepStrictEqual(result, { num: 123 });
	});

	it("should handle extends overriding ref()", async () => {
		const result = await parse('extends "./base.bconf"\nvalue = 999', {
			loader: () => "original = 123\nvalue = ref(original)",
		});
		assert.deepStrictEqual(result, { original: 123, value: 999 });
	});

	it("should handle ref() in extends base", async () => {
		const result = await parse('extends "./base.bconf"\nother = 2', {
			loader: () => "original = 1\ncopy = ref(original)",
		});
		assert.deepStrictEqual(result, { original: 1, copy: 1, other: 2 });
	});

	it("should handle empty object in extends", async () => {
		const result = await parse('extends "./base.bconf"\nobj = {}', {
			loader: () => "obj.key = 1",
		});
		assert.deepStrictEqual(result, { obj: {} });
	});

	it("should handle env() with number-like string", async () => {
		const result = await parse('value = env("NUM")', {
			env: { NUM: "0123" },
		});
		assert.deepStrictEqual(result, { value: "0123" });
	});

	it("should handle string() with scientific notation", async () => {
		const result = await parse("value = string(1.23e10)");
		assert.strictEqual(result.value, "12300000000");
	});

	it("should handle number() with positive sign", async () => {
		const result = await parse('value = number("+42")');
		assert.deepStrictEqual(result, { value: 42 });
	});

	it("should handle int() with very large float", async () => {
		const result = await parse("value = int(999999999.9)");
		assert.deepStrictEqual(result, { value: 999999999 });
	});

	it("should handle bool() with space string", async () => {
		const result = await parse('value = bool(" ")');
		assert.deepStrictEqual(result, { value: true });
	});
});

describe("Resolver Error Messages", () => {
	it("should provide clear error for missing ref target", async () => {
		try {
			await parse("value = ref(missing.key)");
			assert.fail("Should have thrown");
		} catch (err) {
			assert.ok(err instanceof BconfError);
			assert.ok(err.message.includes("missing.key"));
		}
	});

	it("should provide clear error for missing env variable", async () => {
		try {
			await parse('value = env("MISSING")');
			assert.fail("Should have thrown");
		} catch (err) {
			assert.ok(err instanceof BconfError);
			assert.ok(err.message.includes("MISSING"));
		}
	});

	it("should provide clear error for invalid number conversion", async () => {
		try {
			await parse('value = number("abc")');
			assert.fail("Should have thrown");
		} catch (err) {
			assert.ok(err instanceof BconfError);
			assert.ok(err.message.includes("invalid number"));
		}
	});

	it("should provide clear error for missing import variable", async () => {
		try {
			await parse('import from "./file.bconf" { $missing }', {
				loader: () => "$var = 1\nexport vars { $var }",
			});
			assert.fail("Should have thrown");
		} catch (err) {
			assert.ok(err instanceof BconfError);
			assert.ok(err.message.includes("not exported"));
		}
	});
});
