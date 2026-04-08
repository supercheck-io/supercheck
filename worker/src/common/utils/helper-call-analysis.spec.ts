import { collectUnboundHelperCalls, HelperCall } from './helper-call-analysis';

describe('helper-call-analysis', () => {
  const collect = (script: string): HelperCall[] =>
    collectUnboundHelperCalls(script);

  describe('basic detection', () => {
    it('should detect bare readFile call', () => {
      const calls = collect(`readFile('DATA');`);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should detect bare getFile call', () => {
      const calls = collect(`getFile('CONFIG');`);
      expect(calls).toEqual([{ name: 'getFile', literalKey: 'CONFIG' }]);
    });

    it('should detect calls with dynamic keys', () => {
      const calls = collect(`readFile(key);`);
      expect(calls).toEqual([{ name: 'readFile', literalKey: undefined }]);
    });

    it('should not detect obj.readFile() member calls', () => {
      expect(collect(`fs.readFile('path')`)).toHaveLength(0);
    });

    it('should suppress calls shadowed by local function declaration', () => {
      const script = `
        function readFile(path) { return path; }
        readFile('/tmp/file');
      `;
      expect(collect(script)).toHaveLength(0);
    });

    it('should suppress calls shadowed by local variable', () => {
      const script = `
        const readFile = (path) => path;
        readFile('/tmp/file');
      `;
      expect(collect(script)).toHaveLength(0);
    });

    it('should suppress calls shadowed by import', () => {
      const script = `
        import { readFile } from 'fs';
        readFile('/tmp/file');
      `;
      expect(collect(script)).toHaveLength(0);
    });
  });

  describe('globalThis detection', () => {
    it('should detect globalThis.readFile() calls', () => {
      const calls = collect(`globalThis.readFile('DATA');`);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should detect globalThis.getFile() calls', () => {
      const calls = collect(`globalThis.getFile('CONFIG');`);
      expect(calls).toEqual([{ name: 'getFile', literalKey: 'CONFIG' }]);
    });

    it('should detect globalThis calls with dynamic keys', () => {
      const calls = collect(`globalThis.readFile(key);`);
      expect(calls).toEqual([{ name: 'readFile', literalKey: undefined }]);
    });

    it('should detect globalThis calls even when name is locally shadowed', () => {
      const script = `
        const readFile = (path) => path;
        readFile('/tmp/file');
        globalThis.readFile('DATA');
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should not detect other-object.readFile() as globalThis', () => {
      expect(collect(`window.readFile('DATA')`)).toHaveLength(0);
      expect(collect(`self.readFile('DATA')`)).toHaveLength(0);
    });

    it('should detect globalThis calls alongside bare calls', () => {
      const script = `
        globalThis.readFile('A');
        getFile('B');
      `;
      const calls = collect(script);
      expect(calls).toHaveLength(2);
      expect(calls).toContainEqual({ name: 'readFile', literalKey: 'A' });
      expect(calls).toContainEqual({ name: 'getFile', literalKey: 'B' });
    });
  });

  describe('default-parameter initializer traversal', () => {
    it('should detect readFile in function default parameter', () => {
      const script = `
        function load(data = readFile('DATA')) {
          return data;
        }
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should detect getFile in arrow function default parameter', () => {
      const script = `
        const load = (path = getFile('CONFIG')) => path;
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'getFile', literalKey: 'CONFIG' }]);
    });

    it('should detect helper in nested destructuring default', () => {
      const script = `
        function load({ data = readFile('DATA') } = {}) {
          return data;
        }
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should detect helper in array destructuring default', () => {
      const script = `
        function load([first = readFile('DATA')] = []) {
          return first;
        }
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should not detect shadowed helper in default parameter', () => {
      const script = `
        function load(readFile = () => 'nope', data = readFile()) {
          return data;
        }
      `;
      const calls = collect(script);
      // readFile is a parameter binding, so readFile() in the second default
      // is bound to the parameter, not the global helper
      expect(calls).toHaveLength(0);
    });
  });

  describe('regex fallback - nested declarations should not shadow globally', () => {
    it('should detect readFile outside a function that declares readFile locally', () => {
      // Force regex fallback by using TypeScript syntax (type annotation)
      const script = `
        function helper(): void {
          const readFile = (p: string) => p;
          readFile('/tmp/file');
        }
        readFile('DATA');
      `;
      // TypeScript syntax triggers regex fallback since acorn can't parse it.
      // The nested `const readFile` should NOT suppress the outer readFile('DATA').
      const calls = collect(script);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.some((c) => c.literalKey === 'DATA')).toBe(true);
    });

    it('should still suppress readFile when an import binding exists', () => {
      // Force regex fallback with TypeScript syntax
      const script = `
        import { readFile } from 'fs';
        const data: string = readFile('/tmp/file');
      `;
      const calls = collect(script);
      expect(calls).toHaveLength(0);
    });

    it('should detect globalThis.readFile in regex fallback', () => {
      // Force regex fallback with TypeScript syntax
      const script = `
        const data: string = globalThis.readFile('DATA');
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should detect globalThis.readFile even when import shadows bare calls', () => {
      const script = `
        import { readFile } from 'fs';
        const x: string = readFile('/tmp/file');
        const y: string = globalThis.readFile('DATA');
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });
  });

  describe('for-loop scope modeling', () => {
    it('should detect readFile outside a for...of loop that declares readFile', () => {
      const script = `
        for (const readFile of inputs) {
          console.log(readFile);
        }
        readFile('DATA');
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should detect readFile outside a for...in loop that declares readFile', () => {
      const script = `
        for (const readFile in obj) {
          console.log(readFile);
        }
        readFile('DATA');
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should detect readFile outside a for loop that declares readFile', () => {
      const script = `
        for (let readFile = 0; readFile < 10; readFile++) {
          console.log(readFile);
        }
        readFile('DATA');
      `;
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should suppress readFile inside a for...of loop header scope', () => {
      const script = `
        for (const readFile of [readFile('DATA')]) {
          console.log(readFile);
        }
      `;
      // The readFile('DATA') in the iterable expression is in the outer scope
      // where readFile is NOT bound as a loop variable (it's the global helper).
      const calls = collect(script);
      expect(calls).toEqual([{ name: 'readFile', literalKey: 'DATA' }]);
    });

    it('should suppress readFile inside the loop body', () => {
      const script = `
        for (const readFile of inputs) {
          readFile();
        }
      `;
      // readFile inside the loop body is the loop variable, not the helper
      const calls = collect(script);
      expect(calls).toHaveLength(0);
    });

    it('should handle var in for-loop (hoisted to function scope)', () => {
      const script = `
        function test() {
          for (var readFile = 0; readFile < 10; readFile++) {}
          readFile('DATA');
        }
      `;
      // var readFile is hoisted to function scope, so readFile('DATA') is
      // calling the variable, not the helper
      const calls = collect(script);
      expect(calls).toHaveLength(0);
    });
  });

  describe('combined edge cases', () => {
    it('should handle all bug fixes together', () => {
      const script = `
        function load(data = globalThis.readFile('DEFAULT')) {
          return data;
        }
        for (const getFile of items) {
          console.log(getFile);
        }
        getFile('CONFIG');
      `;
      const calls = collect(script);
      expect(calls).toHaveLength(2);
      expect(calls).toContainEqual({
        name: 'readFile',
        literalKey: 'DEFAULT',
      });
      expect(calls).toContainEqual({ name: 'getFile', literalKey: 'CONFIG' });
    });
  });
});
