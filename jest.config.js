module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],
    testMatch: ['**/*.test.ts'],
    roots: ['.'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    moduleNameMapper: {
        '^node-fetch$': 'node-fetch/lib/index.js',
    },
    transformIgnorePatterns: [
        'node_modules/(?!(node-fetch)/)',
    ],
};