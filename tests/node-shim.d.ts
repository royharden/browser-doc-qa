// Minimal declarations for the Node built-in test runner so `tsc` does not need @types/node.
declare module 'node:test' {
  type TestFn = () => void | Promise<void>;
  const test: (name: string, fn: TestFn) => void;
  export default test;
  export { test };
}

declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    fail(message?: string): never;
    throws(fn: () => unknown, expected?: RegExp | ((error: unknown) => boolean), message?: string): void;
    rejects(fn: Promise<unknown> | (() => Promise<unknown>), expected?: RegExp | ((error: unknown) => boolean), message?: string): Promise<void>;
  }
  const assert: Assert;
  export default assert;
}
