import type { IGetLobbyPlayersResult } from '@dice/db';
import type {
  CardDraw,
  CardIndex,
  DrawIndex,
  LobbyPlayer,
  LobbyWithStateProps,
  MatchState,
  PostTxTickEvent,
} from './types';
import Prando from 'paima-sdk/paima-prando';
import {
  deserializeBoardCard,
  deserializeHandCard,
  deserializeLocalCard,
  deserializeMove,
} from './helpers';
import { COMMITMENT_LENGTH, MOVE_KIND, TICK_EVENT_KIND } from './constants';
import { getTurnPlayer } from './dice-logic';
import cryptoRandomString from 'crypto-random-string';

export function genCardDraw(
  currentDraw: DrawIndex,
  currentDeck: CardIndex[],
  randomnessGenerator: Prando
): Omit<CardDraw, 'die'> {
  const seed = `${randomnessGenerator.seed}|drawCard|${currentDraw}`;
  const prando = new Prando(seed);
  const cardNumber = prando.nextInt(0, currentDeck.length - 1);
  return {
    card: { index: currentDeck[cardNumber], draw: currentDraw },
    newDeck: [...currentDeck.slice(0, cardNumber), ...currentDeck.slice(cardNumber + 1)],
  };
}

export function buildCurrentMatchState(
  lobby: LobbyWithStateProps,
  rawPlayers: IGetLobbyPlayersResult[]
): MatchState {
  const players: LobbyPlayer[] = rawPlayers.map(player => {
    if (player.turn == null) throw new Error(`buildCurrentMatchState: player's turn is null`);

    return {
      nftId: player.nft_id,
      startingCommitments: player.starting_commitments,
      currentDeck: player.current_deck,
      currentHand: player.current_hand.map(deserializeHandCard),
      currentBoard: player.current_board.map(deserializeBoardCard),
      currentDraw: player.current_draw,
      botLocalDeck: player.bot_local_deck?.map(deserializeLocalCard),
      turn: player.turn,
      points: player.points,
      score: player.score,
    };
  });

  return {
    players,
    properRound: lobby.current_proper_round,
    turn: lobby.current_turn,
    txEventMove:
      lobby.current_tx_event_move == null
        ? undefined
        : deserializeMove(lobby.current_tx_event_move),
    result: undefined,
  };
}

export function genPostTxEvents(
  matchState: MatchState,
  randomnessGenerator: Prando
): PostTxTickEvent[] {
  const player = getTurnPlayer(matchState);
  const currentDraw = player.currentDraw;
  const currentDeck = player.currentDeck;
  if (matchState.txEventMove?.kind === MOVE_KIND.drawCard) {
    return [
      {
        kind: TICK_EVENT_KIND.postTx,
        draw: genCardDraw(currentDraw, currentDeck, randomnessGenerator),
      },
    ];
  }

  return [];
}

async function buildCommitment(
  crypto: Crypto,
  salt: string,
  cardId: CardIndex
): Promise<Uint8Array> {
  // prepare input for hash function
  const cardIndex = cardId.toString(16).padStart(2, '0');
  const inputBytes = new TextEncoder().encode(cardIndex + salt);
  // Use sha256 hash. It's fast and length extension attacks don't apply to our use-case.
  const hashBytes = await crypto.subtle.digest('SHA-256', inputBytes);
  // Note: For our use-case, finding a pre-image for a commitment is only meaningful for an opponent if they can do so
  // within the duration of the card game so 256 bits is overkill. 128 bits is plenty, and this saves a lot of storage
  // space on-chain. Note 128 → 16 bytes (same as our salt)
  return new Uint8Array(hashBytes.slice(0, COMMITMENT_LENGTH));
}

export async function genCommitments(
  crypto: Crypto,
  deck: CardIndex[]
): Promise<{
  commitments: Uint8Array;
  salt: string[];
}> {
  const raw = await Promise.all(
    deck.map(async cardId => {
      // Generate salt for each card to avoid brute-force attacks.
      // Use COMMITMENT_LENGTH bytes as that's the most security we can get.
      const salt = cryptoRandomString({ length: COMMITMENT_LENGTH * 2 });
      return {
        commitment: await buildCommitment(crypto, salt, cardId),
        salt,
      };
    })
  );

  const commitments = new Uint8Array(raw.length * COMMITMENT_LENGTH);
  raw.forEach(({ commitment }, i) => {
    commitments.set(commitment, i * COMMITMENT_LENGTH);
  });
  const salt = raw.map(r => r.salt);

  return {
    commitments,
    salt,
  };
}

export async function checkCommitment(
  crypto: Crypto,
  commitments: Uint8Array,
  index: number,
  salt: string,
  cardId: number
): Promise<boolean> {
  const commitment = commitments.slice(index * COMMITMENT_LENGTH, (index + 1) * COMMITMENT_LENGTH);
  if (commitment.length !== COMMITMENT_LENGTH) return false;

  const responseCommitment = await buildCommitment(crypto, salt, cardId);
  return commitment.toString() === responseCommitment.toString();
}
