type VersionString = `${number}.${number}.${number}`;
const VERSION_MAJOR = 1;
const VERSION_MINOR = 1;
const VERSION_PATCH = 1;
export const gameBackendVersion: VersionString = `${VERSION_MAJOR}.${VERSION_MINOR}.${VERSION_PATCH}`;
export const GAME_NAME = 'Paima Dice';
export const PRACTICE_BOT_ADDRESS = '0x0';
export const NFT_NAME = 'Dice NFT contract';

export * from './types.js';
