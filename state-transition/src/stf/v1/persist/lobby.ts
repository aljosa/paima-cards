import type { CreatedLobbyInput, JoinedLobbyInput } from '../types.js';
import type { IGetLobbyByIdResult, IStartMatchParams, ICloseLobbyParams } from '@dice/db';
import { createLobby, startMatch, closeLobby, ICreateLobbyParams } from '@dice/db';
import type Prando from 'paima-sdk/paima-prando';
import type { WalletAddress } from 'paima-sdk/paima-utils';
import type { LobbyStatus } from '@dice/utils';
import { PRACTICE_BOT_ADDRESS } from '@dice/utils';
import { blankStats } from './stats';
import { persistNewRound } from './match.js';
import type { SQLUpdate } from 'paima-sdk/paima-db';
import { genRandomSeed } from '@dice/game-logic';

// Persist creation of a lobby
export function persistLobbyCreation(
  player: WalletAddress,
  blockHeight: number,
  inputData: CreatedLobbyInput,
  randomnessGenerator: Prando
): SQLUpdate[] {
  const lobby_id = randomnessGenerator.nextString(12);
  const params = {
    lobby_id: lobby_id,
    num_of_rounds: inputData.numOfRounds,
    round_length: inputData.roundLength,
    play_time_per_player: inputData.playTimePerPlayer,
    current_round: 0,
    current_random_seed: genRandomSeed(randomnessGenerator),
    created_at: new Date(),
    creation_block_height: blockHeight,
    hidden: inputData.isHidden,
    practice: inputData.isPractice,
    lobby_creator: player,
    player_one_iswhite: inputData.playerOneIsWhite,
    player_two: null,
    lobby_state: 'open' as LobbyStatus,
  } satisfies ICreateLobbyParams;

  console.log(`Created lobby ${lobby_id}`);
  // create the lobby according to the input data.
  const createLobbyTuple: SQLUpdate = [createLobby, params];
  // create user metadata if non existent
  const blankStatsTuple: SQLUpdate = blankStats(player);
  // In case of a practice lobby join with a predetermined opponent right away
  const practiceLobbyUpdates = inputData.isPractice
    ? persistLobbyJoin(
        blockHeight,
        PRACTICE_BOT_ADDRESS,
        { input: 'joinedLobby', lobbyID: lobby_id },
        params
      )
    : [];
  return [createLobbyTuple, blankStatsTuple, ...practiceLobbyUpdates];
}

// Persist joining a lobby
export function persistLobbyJoin(
  blockHeight: number,
  joiningPlayer: WalletAddress,
  inputData: JoinedLobbyInput,
  lobby: ICreateLobbyParams
): SQLUpdate[] {
  // First we validate if the lobby is actually open for users to join, before applying.
  // If not, just output an empty list of updates (meaning no state transition is applied)
  if (!lobby.player_two && lobby.lobby_state === 'open' && lobby.lobby_creator !== joiningPlayer) {
    // Save user metadata, like in the lobby creation flow,
    // then convert lobby into active and create empty round and user states
    const updateLobbyTuple = persistActivateLobby(joiningPlayer, lobby, blockHeight, inputData);
    const blankStatsTuple: SQLUpdate = blankStats(joiningPlayer);
    return [...updateLobbyTuple, blankStatsTuple];
  } else return [];
}

// Convert lobby state from `open` to `close`, meaning no one will be able to join the lobby.
export function persistCloseLobby(
  requestingPlayer: WalletAddress,
  lobby: IGetLobbyByIdResult
): SQLUpdate | null {
  if (lobby.player_two || lobby.lobby_state !== 'open' || lobby.lobby_creator !== requestingPlayer)
    return null;

  const params: ICloseLobbyParams = {
    lobby_id: lobby.lobby_id,
  };
  return [closeLobby, params];
}

// Convert lobby from `open` to `active`, meaning the match has now started.
function persistActivateLobby(
  joiningPlayer: WalletAddress,
  lobby: ICreateLobbyParams,
  blockHeight: number,
  _: JoinedLobbyInput
): SQLUpdate[] {
  // First update lobby row, marking its state as now 'active', and saving the joining player's wallet address
  const smParams: IStartMatchParams = {
    lobby_id: lobby.lobby_id,
    player_two: joiningPlayer,
  };
  const newMatchTuple: SQLUpdate = [startMatch, smParams];
  // We insert the round and first two empty user states in their tables at this stage, so the round executor has empty states to iterate from.
  const roundAndStates = persistInitialMatchState(lobby, blockHeight);
  return [newMatchTuple, ...roundAndStates];
}

// Create initial match state, used when a player joins a lobby to init the match.
function persistInitialMatchState(lobby: ICreateLobbyParams, blockHeight: number): SQLUpdate[] {
  const newRoundTuples = persistNewRound(lobby.lobby_id, 0, lobby.round_length, blockHeight);
  return newRoundTuples;
}
