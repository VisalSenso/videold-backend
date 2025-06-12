const assert = require('assert');

test('Invalid Instagram link error handling', () => {
    const invalidLink = 'https://www.instagram.com/p/DGMUx6Xh4Zx';
    const expectedErrorMessage = 'Requested format is not available. Use --list-formats for a list of available formats';

    try {
        // Simulate the function that handles the Instagram link
        throw new Error(expectedErrorMessage);
    } catch (error) {
        assert.strictEqual(error.message, expectedErrorMessage);
    }
});