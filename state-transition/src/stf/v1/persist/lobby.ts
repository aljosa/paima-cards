import type { CreatedLobbyInput } from '../types.js';
import type { IUpdateLobbyStateParams, ICreateLobbyParams } from '@dice/db';
import { createLobby, updateLobbyState } from '@dice/db';
import Prando from 'paima-sdk/paima-prando';
import type { LobbyPlayer, LobbyStatus, LocalCard, MatchEnvironment } from '@dice/game-logic';
import { genBotDeck, genCommitments, initialCurrentDeck } from '@dice/game-logic';
import { persistStartMatch } from './match.js';
import type { SQLUpdate } from 'paima-sdk/paima-db';
import type { IJoinPlayerToLobbyParams } from '@dice/db/src/insert.queries.js';
import { joinPlayerToLobby } from '@dice/db/src/insert.queries.js';
import { PRACTICE_BOT_NFT_ID } from '@dice/utils';
import crypto from 'crypto';

// Persist creation of a lobby
export async function persistLobbyCreation(
  blockHeight: number,
  inputData: CreatedLobbyInput,
  seed: string,
  randomnessGenerator: Prando
): Promise<SQLUpdate[]> {
  const lobby_id = new Prando(seed).nextString(12);
  const lobbyPlayers: LobbyPlayer[] = [];

  // create the lobby
  const lobbyParams: ICreateLobbyParams = {
    lobby_id: lobby_id,
    // note: can be adjusted, but we don't have frontend for more
    max_players: 2,
    num_of_rounds: inputData.numOfRounds,
    round_length: inputData.roundLength,
    play_time_per_player: inputData.playTimePerPlayer,
    created_at: new Date(),
    creation_block_height: blockHeight,
    hidden: inputData.isHidden,
    practice: inputData.isPractice,
    lobby_creator: inputData.creatorNftId,
    lobby_state: 'open' as LobbyStatus,
  };
  const createLobbyTuple: SQLUpdate = [createLobby, lobbyParams];

  // join creator to lobby
  lobbyPlayers.push({
    nftId: inputData.creatorNftId,
    startingCommitments: inputData.creatorCommitments,
    currentDeck: initialCurrentDeck(),
    currentHand: [],
    currentDraw: 0,
    points: 0,
    score: 0,
    turn: undefined,
  });
  const joinCreatorUpdates = persistLobbyJoin({
    lobby_id,
    nft_id: inputData.creatorNftId,
    startingCommitments: inputData.creatorCommitments,
  });

  // TODO: We reference players by nftId, so you can't have more than 1 bot
  const numBots = inputData.isPractice ? lobbyParams.max_players - lobbyPlayers.length : 0;
  const joinBots: SQLUpdate[] = (
    await Promise.all(
      Array(numBots)
        .fill(null)
        .map(async () => {
          const botDeck = genBotDeck();
          const commitments = await genCommitments(crypto as any, botDeck);
          // TODO: store local deck for the bot
          const localDeck: LocalCard[] = botDeck.map((cardId, i) => ({
            cardId,
            salt: commitments.salt[i],
          }));

          lobbyPlayers.push({
            nftId: PRACTICE_BOT_NFT_ID,
            startingCommitments: commitments.commitments,
            currentDeck: initialCurrentDeck(),
            currentHand: [],
            currentDraw: 0,
            points: 0,
            score: 0,
            turn: undefined,
          });
          return persistLobbyJoin({
            lobby_id,
            nft_id: PRACTICE_BOT_NFT_ID,
            startingCommitments: commitments.commitments,
          });
        })
    )
  ).flat();

  const closeLobbyUpdates: SQLUpdate[] =
    lobbyPlayers.length < lobbyParams.max_players
      ? []
      : persistLobbyState({ lobby_id, lobby_state: 'closed' });

  const matchEnvironment: MatchEnvironment = {
    practice: lobbyParams.practice,
    numberOfRounds: lobbyParams.num_of_rounds,
  };
  // Automatically activate a lobby when it fills up.
  // Note: This could be replaced by some input from creator.
  const activateLobbyUpdates: SQLUpdate[] =
    lobbyPlayers.length < lobbyParams.max_players
      ? []
      : persistStartMatch(
          lobby_id,
          matchEnvironment,
          lobbyPlayers,
          null,
          lobbyParams.round_length,
          blockHeight,
          randomnessGenerator
        );

  console.log(`Created lobby ${lobby_id}`);
  return [
    createLobbyTuple,
    ...joinCreatorUpdates,
    ...joinBots,
    ...closeLobbyUpdates,
    ...activateLobbyUpdates,
  ];
}

export type IJoinPlayerToLobbyRequest = {
  lobby_id: IJoinPlayerToLobbyParams['lobby_id'];
  nft_id: IJoinPlayerToLobbyParams['nft_id'];
  startingCommitments: Uint8Array;
};
export function persistLobbyJoin(req: IJoinPlayerToLobbyRequest): SQLUpdate[] {
  const params: IJoinPlayerToLobbyParams = {
    lobby_id: req.lobby_id,
    nft_id: req.nft_id,
    starting_commitments: Buffer.from(req.startingCommitments),
    current_deck: initialCurrentDeck(),
  };

  return [[joinPlayerToLobby, params]];
}

export function persistLobbyState(params: IUpdateLobbyStateParams): SQLUpdate[] {
  return [[updateLobbyState, params]];
}
