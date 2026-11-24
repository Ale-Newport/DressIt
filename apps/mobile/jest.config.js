/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Node crawler: works even where the local watchman install is broken.
  watchman: false,
  setupFiles: ['<rootDir>/jest.setup.js'],
  resolver: 'react-native-reanimated/jest/resolver',
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|@react-native-async-storage|expo|@expo|@expo-google-fonts|expo-share-intent|react-navigation|@react-navigation|@shopify/flash-list|@tanstack|i18next|react-i18next|standard-navigation))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/dist-ios/', '/dist-android/'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
};
