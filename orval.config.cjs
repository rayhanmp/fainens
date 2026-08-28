/** Generated client configuration. Keep output checked in and never hand-edit it. */
module.exports = {
  fainens: {
    input: { target: './contracts/openapi.json' },
    output: {
      target: './frontend/src/generated/client.ts',
      client: 'fetch',
      mode: 'single',
      override: {
        mutator: { path: './frontend/src/lib/generated-fetch.ts', name: 'generatedFetch' },
      },
    },
  },
};
