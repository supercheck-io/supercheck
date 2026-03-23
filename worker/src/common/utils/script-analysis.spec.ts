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
      const scripts = [
        `getFile('DATA'); getFile('DATA');`,
        `getFile('DATA');`,
      ];
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
  });

  describe('filterFileVariablesToUsedKeys', () => {
    const allFiles = {
      DATA: { storagePath: 's3/data.csv', fileName: 'data.csv', mimeType: 'text/csv', fileSize: 100 },
      CONFIG: { storagePath: 's3/config.json', fileName: 'config.json', mimeType: 'application/json', fileSize: 50 },
      UNUSED: { storagePath: 's3/unused.txt', fileName: 'unused.txt', mimeType: 'text/plain', fileSize: 10 },
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

    it('should return full map when getFile is called with dynamic keys', () => {
      const scripts = [`const key = someCondition ? 'A' : 'B'; const p = getFile(key);`];
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
      const scripts = [
        `getFile('DATA');`,
        `getFile('CONFIG');`,
      ];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA']);
    });

    it('should not include keys not in the files map', () => {
      const scripts = [`getFile('NONEXISTENT');`];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should return full map when script mixes literal and dynamic getFile keys', () => {
      const scripts = [`
        const common = getFile('DATA');
        const dynamic = getFile(selectedKey);
      `];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      // Must return full map because the dynamic getFile(selectedKey) could
      // resolve to any key at runtime
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA', 'UNUSED']);
    });

    it('should return full map when multiple scripts contain mixed literal and dynamic keys', () => {
      const scripts = [
        `getFile('CONFIG');`,
        `getFile(dynamicVar);`,
      ];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA', 'UNUSED']);
    });

    it('should filter normally when all getFile calls use literal keys', () => {
      const scripts = [
        `getFile('DATA');`,
        `getFile('CONFIG');`,
      ];
      const result = filterFileVariablesToUsedKeys(allFiles, scripts);
      expect(Object.keys(result).sort()).toEqual(['CONFIG', 'DATA']);
    });

    it('should not false-positive on injected runtime helper defining getFile', () => {
      // Simulates the runtime helper that defines getFile() — should not
      // cause the filter to include all files when user code doesn't call it
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
      // When using raw user scripts (not including runtime helper), no files needed
      const result = filterFileVariablesToUsedKeys(allFiles, [userScript]);
      expect(Object.keys(result)).toHaveLength(0);

      // When runtime helper is accidentally included, getFile IS detected
      // (this is the P1 bug scenario — should use raw scripts instead)
      const resultWithHelper = filterFileVariablesToUsedKeys(allFiles, [runtimeHelper + userScript]);
      expect(Object.keys(resultWithHelper).sort()).toEqual(['CONFIG', 'DATA', 'UNUSED']);
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
  });
});
