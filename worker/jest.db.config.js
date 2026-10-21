const base = require('./jest.config');
module.exports = {
  ...base,
  rootDir: '.',
  testRegex: 'test/.*\\.db\\.spec\\.ts$',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  coverageThreshold: {},
};
