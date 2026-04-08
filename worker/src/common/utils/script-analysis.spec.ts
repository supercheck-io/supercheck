import {
  extractGetFileKeys,
  filterFileVariablesToUsedKeys,
  scriptsContainGetFile,
  countAllGetFileCalls,
  countLiteralGetFileCalls,
} from './script-analysis';

describe('script-analysis', () => {
  describe('extractGetFileKeys', () => {
    it('should extract getFile keys from a single script', () => {
      const script = `
        const csvPath = getFile('TEST_DATA');
        const configPath = getFile("CONFIG");
      `;
      const keys = extractGetFileKeys([script]);
      expect(keys).toEqual(new Set(['TEST_DATA', 'CONFIG']));
    });

    it('should extract keys across multiple scripts', () => {
      const scripts = [
        `const a = getFile('FILE_A');`,
        `const b = getFile('FILE_B');`,
      ];
      const keys = extractGetFileKeys(scripts);
      expect(keys).toEqual(new Set(['FILE_A', 'FILE_B']));
    });

    it('should deduplicate keys', () => {
      const scripts = [`getFile('DATA'); getFile('DATA');`, `getFile('DATA');`];
      const keys = extractGetFileKeys(scripts);
      expect(keys).toEqual(new Set(['DATA']));
    });

    it('should return empty set when no getFile calls exist', () => {
      const script = `const x = getVariable('VAR'); getSecret('SEC');`;
      const keys = extractGetFileKeys([script]);
      expect(keys.size).toBe(0);
    });

    it('should handle empty scripts array', () => {
      expect(extractGetFileKeys([]).size).toBe(0);
    });

    it('should handle getFile with template literal quotes', () => {
      const script = 'const p = getFile(`MY_FILE`);';
      const keys = extractGetFileKeys([script]);
      expect(keys).toEqual(new Set(['MY_FILE']));
    });

    it('should handle whitespace variations', () => {
      const script = `getFile( 'SPACED' )`;
      const keys = extractGetFileKeys([script]);
      expect(keys).toEqual(new Set(['SPACED']));
    });

    it('should extract readFile keys', () => {
      const script = `const csv = readFile('TEST_DATA');`;
      const keys = extractGetFileKeys([script]);
      expect(keys).toEqual(new Set(['TEST_DATA']));
    });

    it('should extract both getFile and readFile keys', () => {
      const script = `
        const path = getFile('CONFIG');
        const content = readFile('TEST_DATA');
      `;
      const keys = extractGetFileKeys([script]);
      expect(keys).toEqual(new Set(['CONFIG', 'TEST_DATA']));
    });

    it('should extract readFile with encoding parameter', () => {
      const script = `const data = readFile('USERS_CSV', 'utf-8');`;
      const keys = extractGetFileKeys([script]);
      expect(keys).toEqual(new Set(['USERS_CSV']));
    });

    it('should ignore locally declared readFile helpers', () => {
      const script = `
        function readFile(path) {
          return path;
        }

        const csv = readFile('/tmp/users.csv');
      `;
      const keys = extractGetFileKeys([script]);
      expect(keys.size).toBe(0);
    });
  });

  describe('filterFileVariablesToUsedKeys', () => {
    const allFiles = {
      DATA: {
        storagePath: 's3/data.csv',
        fileName: 'data.csv',
        mimeType: 'text/csv',
        fileSize: 100,
      },
      CONFIG: {
        storagePath: 's3/config.json',
        fileName: 'config.json',
        mimeType: 'application/json',
        fileSize: 50,
      },
      UNUSED: {
        storagePath: 's3/unused.txt',
        fileName: 'unused.txt',
        mimeType: 'text/plain',
        fileSize: 10,
      },
    };

    it('should filter to only referenced file keys', () => {
      const scripts = [`const p = getFile('DATA');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toEqual(['DATA']);
      expect(result.DATA).toEqual(allFiles.DATA);
    });

    it('should return empty object when no getFile calls exist', () => {
      const scripts = [`const x = getVariable('VAR');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should include files referenced by readFile() calls', () => {
      const scripts = [`const csv = readFile('DATA');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toEqual(['DATA']);
    });

    it('should ignore locally declared readFile helpers', () => {
      const scripts = [
        `
        function readFile(path) {
          return path;
        }

        const csv = readFile('/tmp/users.csv');
      `,
      ];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should include files referenced by both getFile and readFile calls', () => {
      const scripts = [
        `const path = getFile('CONFIG');`,
        `const csv = readFile('DATA');`,
      ];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA']);
    });

    it('should return full map when readFile is called with dynamic keys', () => {
      const scripts = [`const key = 'DATA'; const csv = readFile(key);`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA', 'UNUSED']);
    });

    it('should return full map when getFile is called with dynamic keys', () => {
      const scripts = [
        `const key = someCondition ? 'A' : 'B'; const p = getFile(key);`,
      ];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA', 'UNUSED']);
    });

    it('should return full map when scripts is empty', () => {
      const result = filterFileVariablesToUsedKeys(allFiles, []);
      expect(result).toBe(allFiles);
    });

    it('should return empty files as-is', () => {
      const empty = {};
      const result = filterFileVariablesToUsedKeys(empty, [`getFile('X')`]);
      expect(result).toBe(empty);
    });

    it('should handle multiple scripts referencing different files', () => {
      const scripts = [`getFile('DATA');`, `getFile('CONFIG');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA']);
    });

    it('should not include keys not in the files map', () => {
      const scripts = [`getFile('NONEXISTENT');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should return full map when script mixes literal and dynamic getFile keys', () => {
      const scripts = [
        `
        const common = getFile('DATA');
        const dynamic = getFile(selectedKey);
      `,
      ];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      // Must return full map because the dynamic getFile(selectedKey) could
      // resolve to any key at runtime
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA', 'UNUSED']);
    });

    it('should return full map when multiple scripts contain mixed literal and dynamic keys', () => {
      const scripts = [`getFile('CONFIG');`, `getFile(dynamicVar);`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA', 'UNUSED']);
    });

    it('should filter normally when all getFile calls use literal keys', () => {
      const scripts = [`getFile('DATA');`, `getFile('CONFIG');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA']);
    });

    it('should not false-positive on injected runtime helper defining getFile', () => {
      // Simulates the runtime helper that defines getFile() — this should not
      // cause the filter to include files when user code never calls it.
      const runtimeHelper = `
        globalThis.getFile = function getFile(key) {
          const filePath = __scFiles[key];
          if (filePath === undefined) {
            throw new Error("File variable '" + key + "' is not defined.");
          }
          return __scTmpDir + '/' + filePath;
        };
      `;
      const userScript = `const x = getVariable('VAR');`;
      const result = filterFileVariablesToUsedKeys(allFiles, [userScript]);
      expect(Object.keys(result)).toHaveLength(0);

      const resultWithHelper = filterFileVariablesToUsedKeys(allFiles, [
        runtimeHelper + userScript,
      ]);
      expect(Object.keys(resultWithHelper)).toHaveLength(0);
    });
  });

  describe('countAllGetFileCalls', () => {
    it('should count all getFile calls including dynamic and literal', () => {
      const scripts = [`getFile('A'); getFile(b); getFile('C');`];
      expect(countAllGetFileCalls(scripts)).toBe(3);
    });

    it('should count across multiple scripts', () => {
      const scripts = [`getFile('A');`, `getFile(x); getFile('B');`];
      expect(countAllGetFileCalls(scripts)).toBe(3);
    });

    it('should return 0 for no getFile calls', () => {
      expect(countAllGetFileCalls([`getVariable('X');`])).toBe(0);
    });

    it('should count readFile calls', () => {
      const scripts = [`readFile('A'); getFile('B'); readFile(c);`];
      expect(countAllGetFileCalls(scripts)).toBe(3);
    });

    it('should not count locally declared readFile helpers', () => {
      const scripts = [
        `
        function readFile(path) {
          return path;
        }

        readFile('/tmp/users.csv');
        getFile('B');
      `,
      ];
      expect(countAllGetFileCalls(scripts)).toBe(1);
    });
  });

  describe('countLiteralGetFileCalls', () => {
    it('should count only literal getFile calls', () => {
      const scripts = [`getFile('A'); getFile(b); getFile('C');`];
      expect(countLiteralGetFileCalls(scripts)).toBe(2);
    });

    it('should return 0 when all calls are dynamic', () => {
      expect(countLiteralGetFileCalls([`getFile(x); getFile(y);`])).toBe(0);
    });

    it('should count across multiple scripts', () => {
      const scripts = [`getFile('A');`, `getFile("B"); getFile(z);`];
      expect(countLiteralGetFileCalls(scripts)).toBe(2);
    });

    it('should count literal readFile calls', () => {
      const scripts = [`readFile('A'); readFile(b); getFile('C');`];
      expect(countLiteralGetFileCalls(scripts)).toBe(2);
    });

    it('should not count literals for locally declared readFile helpers', () => {
      const scripts = [
        `
        function readFile(path) {
          return path;
        }

        readFile('/tmp/users.csv');
        getFile('C');
      `,
      ];
      expect(countLiteralGetFileCalls(scripts)).toBe(1);
    });
  });

  describe('scriptsContainGetFile', () => {
    it('should return true when getFile is called with a string literal', () => {
      expect(scriptsContainGetFile([`getFile('KEY')`])).toBe(true);
    });

    it('should return true when getFile is called with a variable', () => {
      expect(scriptsContainGetFile([`getFile(dynamicKey)`])).toBe(true);
    });

    it('should return false when getFile is not present', () => {
      expect(scriptsContainGetFile([`getVariable('X')`])).toBe(false);
    });

    it('should return false for empty scripts', () => {
      expect(scriptsContainGetFile([])).toBe(false);
    });

    it('should return true when readFile is called', () => {
      expect(scriptsContainGetFile([`readFile('KEY')`])).toBe(true);
    });

    it('should return true when readFile is called with dynamic key', () => {
      expect(scriptsContainGetFile([`readFile(dynamicKey)`])).toBe(true);
    });

    it('should return false for fs.readFile() method call', () => {
      expect(scriptsContainGetFile([`fs.readFile(path)`])).toBe(false);
    });

    it('should return false for object.getFile() method call', () => {
      expect(scriptsContainGetFile([`page.getFile(path)`])).toBe(false);
    });

    it('should return false for myreadFile() prefixed identifier', () => {
      expect(scriptsContainGetFile([`myreadFile(path)`])).toBe(false);
    });

    it('should return false for mygetFile() prefixed identifier', () => {
      expect(scriptsContainGetFile([`mygetFile(path)`])).toBe(false);
    });

    it('should return false for this.readFile() method call', () => {
      expect(scriptsContainGetFile([`this.readFile(path)`])).toBe(false);
    });

    it('should return false for a locally declared readFile helper', () => {
      const script = `
        function readFile(path) {
          return path;
        }

        readFile('/tmp/users.csv');
      `;
      expect(scriptsContainGetFile([script])).toBe(false);
    });
  });

  describe('extractGetFileKeys - false positive prevention', () => {
    it('should not extract keys from fs.readFile() calls', () => {
      const scripts = [`fs.readFile('data.csv')`];
      const keys = extractGetFileKeys(scripts);
      expect(keys.size).toBe(0);
    });

    it('should not extract keys from object.getFile() calls', () => {
      const scripts = [`page.getFile('CONFIG')`];
      const keys = extractGetFileKeys(scripts);
      expect(keys.size).toBe(0);
    });

    it('should not extract keys from prefixed identifiers', () => {
      const scripts = [`myreadFile('KEY'); mygetFile('KEY2')`];
      const keys = extractGetFileKeys(scripts);
      expect(keys.size).toBe(0);
    });

    it('should still extract keys from standalone getFile/readFile calls', () => {
      const scripts = [`const x = getFile('A'); const y = readFile('B');`];
      const keys = extractGetFileKeys(scripts);
      expect(keys).toEqual(new Set(['A', 'B']));
    });
  });

  describe('countAllGetFileCalls - false positive prevention', () => {
    it('should not count fs.readFile() as a getFile call', () => {
      expect(countAllGetFileCalls([`fs.readFile(path)`])).toBe(0);
    });

    it('should not count prefixed identifiers', () => {
      expect(countAllGetFileCalls([`myreadFile(path); mygetFile(x)`])).toBe(0);
    });

    it('should count standalone calls correctly', () => {
      expect(countAllGetFileCalls([`readFile('A'); getFile(b)`])).toBe(2);
    });
  });

  describe('filterFileVariablesToUsedKeys - false positive prevention', () => {
    const allFiles = {
      DATA: {
        storagePath: 's3/data.csv',
        fileName: 'data.csv',
        mimeType: 'text/csv',
        fileSize: 100,
      },
      CONFIG: {
        storagePath: 's3/config.json',
        fileName: 'config.json',
        mimeType: 'application/json',
        fileSize: 50,
      },
    };

    it('should return empty when only fs.readFile() is present (not Supercheck helper)', () => {
      const scripts = [`const data = fs.readFile('some/path.csv');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should return empty when only prefixed readFile is present', () => {
      const scripts = [`myreadFile(path); customGetFile(x);`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should filter correctly when both fs.readFile and standalone readFile exist', () => {
      const scripts = [`fs.readFile(path); readFile('DATA');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toEqual(['DATA']);
    });

    it('should ignore locally declared readFile helpers when scanning files', () => {
      const scripts = [
        `
        function readFile(path) {
          return path;
        }

        readFile('/tmp/users.csv');
      `,
      ];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});
