module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  extends: [
    'prettier',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'plugin:import/typescript',
  ],
  parserOptions: {
    project: ['./tsconfig.json', './*/tsconfig.json'],
    tsconfigRootDir: './',
    ecmaVersion: 2019,
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/explicit-member-accessibility': 0,
    '@typescript-eslint/explicit-function-return-type': 0,
    '@typescript-eslint/no-parameter-properties': 0,
    '@typescript-eslint/interface-name-prefix': 0,
    '@typescript-eslint/explicit-module-boundary-types': 0,
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector: 'default',
        format: null,
        leadingUnderscore: 'allow',
      },
      {
        selector: 'typeLike',
        format: ['PascalCase'],
        leadingUnderscore: 'allow',
      },
    ],
    '@typescript-eslint/consistent-type-imports': 'error',
    'spaced-comment': 'warn',
  },
  settings: {
    'import/resolver': {
      typescript: {},
    },
  },
};
